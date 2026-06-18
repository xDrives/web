// ==================== PRIBOX SECURE SHARE - UNIQUE VISITOR TRACKING ====================

// Main database URL (only for configuration)
const MAIN_DB_URL = "https://pribox-apps-default-rtdb.europe-west1.firebasedatabase.app/";

// Will be set after discovery
let SHARE_DB_URL = null;
let shareDB = null;

const urlParams = new URLSearchParams(window.location.search);
const linkId = urlParams.get('id');

let linkData = null;
let viewIncremented = false;
let uniqueIncrementedForThisUser = false;
let currentPhotoIndex = 0;
let currentPhotos = [];
let countdownInterval = null;
let isContentDisplayed = false;
let isDestroyed = false;

// ========== UNIQUE VISITOR HELPERS ==========
function getOrCreateVisitorId() {
    let visitorId = localStorage.getItem('pribox_visitor_id');
    if (!visitorId) {
        visitorId = 'vis_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        localStorage.setItem('pribox_visitor_id', visitorId);
    }
    return visitorId;
}

function hasVisitorSeenLink(linkId) {
    const seen = localStorage.getItem(`pribox_seen_${linkId}`);
    return seen === 'true';
}

function markVisitorSeenLink(linkId) {
    localStorage.setItem(`pribox_seen_${linkId}`, 'true');
}

// ========== STEP 1: DISCOVER SHARE DATABASE URL FROM MAIN DATABASE ==========
async function discoverShareDatabaseUrl() {
    try {
        console.log('Discovering share database URL from main database...');
        const response = await fetch(`${MAIN_DB_URL}/shareURL/url.json`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data) {
            SHARE_DB_URL = data;
            console.log('Share database URL discovered:', SHARE_DB_URL);
            return SHARE_DB_URL;
        } else {
            throw new Error('No share database URL found in main database');
        }
    } catch (error) {
        console.error('Error discovering share database URL:', error);
        throw new Error('Unable to locate share database. Please try again later.');
    }
}

// ========== STEP 2: ALL DATABASE OPERATIONS USE THE DISCOVERED SHARE DB ==========
async function getData(path) {
    if (!SHARE_DB_URL) await discoverShareDatabaseUrl();
    try {
        const response = await fetch(`${SHARE_DB_URL}/${path}.json`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (err) { 
        console.error('Fetch error:', err); 
        return null; 
    }
}

async function putData(path, data) {
    if (!SHARE_DB_URL) await discoverShareDatabaseUrl();
    try {
        const response = await fetch(`${SHARE_DB_URL}/${path}.json`, {
            method: 'PUT', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(data)
        });
        return response.ok;
    } catch (err) { 
        console.error('Put error:', err);
        return false; 
    }
}

async function patchData(path, data) {
    if (!SHARE_DB_URL) await discoverShareDatabaseUrl();
    try {
        const response = await fetch(`${SHARE_DB_URL}/${path}.json`, {
            method: 'PATCH', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify(data)
        });
        return response.ok;
    } catch (err) { 
        console.error('Patch error:', err);
        return false; 
    }
}

async function incrementUniqueVisitor(linkId) {
    if (uniqueIncrementedForThisUser) return;
    try {
        const currentUnique = linkData.uniqueVisitors || 0;
        const newUnique = currentUnique + 1;
        const success = await putData(`shareLinks/${linkId}/uniqueVisitors`, newUnique);
        if (success) {
            linkData.uniqueVisitors = newUnique;
            uniqueIncrementedForThisUser = true;
            markVisitorSeenLink(linkId);
        }
    } catch (err) {
        console.error("Unique visitor increment error:", err);
    }
}

async function incrementViews() {
    if (viewIncremented || !linkData) return;
    try {
        const currentViews = linkData.views || 0;
        const newViews = currentViews + 1;
        const success = await putData(`shareLinks/${linkId}/views`, newViews);
        if (success) { 
            linkData.views = newViews; 
            viewIncremented = true; 
        }
    } catch (err) { 
        console.error("View increment error:", err); 
    }
}

async function destroyViewOnceLink() {
    if (!linkData || !linkData.viewOnce || linkData.isDestroyed) return;
    try {
        const destroyed = await putData(`shareLinks/${linkId}/isDestroyed`, true);
        if (destroyed) { 
            linkData.isDestroyed = true; 
            isDestroyed = true; 
        }
    } catch (err) { 
        console.error("Destroy error:", err); 
    }
}

// Unified timer
function startViewOnceCountdown(callback) {
    let secondsLeft = (linkData.viewOnceSeconds && linkData.viewOnceSeconds >= 1 && linkData.viewOnceSeconds <= 60) 
        ? linkData.viewOnceSeconds : 3;
    
    countdownInterval = setInterval(() => {
        secondsLeft--;
        if (secondsLeft <= 0) {
            clearInterval(countdownInterval);
            destroyViewOnceLink().then(() => {
                const mainDisplayDiv = document.getElementById('contentDisplay');
                mainDisplayDiv.innerHTML = `
                    <div class="destroyed-message">
                        <span class="material-icons">delete_forever</span>
                        <h3 style="margin-bottom: 12px; font-weight: 600;">Content Destroyed</h3>
                        <p style="font-size:0.85rem;">This content was set to "View Once" mode and has been permanently destroyed.</p>
                        <p style="font-size:0.75rem; margin-top:12px; opacity:0.7;">The secure link is no longer valid.</p>
                    </div>
                `;
                const backBtn = document.getElementById('backToUnlockBtn');
                if (backBtn) { 
                    backBtn.disabled = true; 
                    backBtn.style.opacity = '0.5'; 
                    backBtn.style.cursor = 'not-allowed';
                }
            });
            if (callback) callback();
        }
    }, 1000);
}

// Build mixed content (text + photos) with unique visitor stats
function buildMixedHTML() {
    const title = linkData.title || 'Shared Content';
    const viewOnceBadge = linkData.viewOnce ? '<span class="badge-pribox badge-viewonce">View Once</span>' : '';
    const accessBadge = linkData.hasPassword ? 
        '<span class="badge-pribox badge-password">Protected</span>' : 
        '<span class="badge-pribox badge-open">Open Access</span>';
    
    let html = `<div class="content-display-card">
        <div class="content-header">
            <div class="content-title"><span class="material-icons">article</span> ${escapeHtml(title)}</div>
            <div class="badge-group">${accessBadge} ${viewOnceBadge}</div>
        </div>`;
    
    if (linkData.textContent && linkData.textContent.trim()) {
        html += `<div class="content-body-text">${escapeHtml(linkData.textContent).replace(/\n/g, '<br>')}</div>`;
    }
    
    const photos = linkData.photos || [];
    if (photos.length > 0) {
        currentPhotos = photos;
        html += `<div class="photo-gallery-pribox" id="photoGalleryGrid">`;
        photos.forEach((photo, idx) => {
            html += `
                <div class="photo-card-pribox" data-photo-index="${idx}">
                    <img src="${photo.url}" alt="${escapeHtml(photo.name)}" loading="lazy" onerror="this.src='https://via.placeholder.com/300?text=Error'">
                    <div class="photo-info">
                        <div class="photo-meta">${photo.size ? photo.size : ''} ${photo.date ? photo.date : ''}</div>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
    }
    
    html += buildMetaFooter() + `</div>`;
    return html;
}

function buildTextHTML() {
    const title = linkData.title || 'Untitled';
    const viewOnceBadge = linkData.viewOnce ? '<span class="badge-pribox badge-viewonce">View Once</span>' : '';
    const accessBadge = linkData.hasPassword ? 
        '<span class="badge-pribox badge-password">Protected</span>' : 
        '<span class="badge-pribox badge-open">Open Access</span>';
    return `
        <div class="content-display-card">
            <div class="content-header">
                <div class="content-title"><span class="material-icons">description</span> ${escapeHtml(title)}</div>
                <div class="badge-group">${accessBadge} ${viewOnceBadge}</div>
            </div>
            <div class="content-body-text">${escapeHtml(linkData.content || 'No content available.').replace(/\n/g, '<br>')}</div>
            ${buildMetaFooter()}
        </div>
    `;
}

function buildPhotoHTML() {
    const photos = linkData.photos || [];
    const title = linkData.title || 'Shared Photos';
    const viewOnceBadge = linkData.viewOnce ? '<span class="badge-pribox badge-viewonce">View Once</span>' : '';
    const accessBadge = linkData.hasPassword ? 
        '<span class="badge-pribox badge-password">Protected</span>' : 
        '<span class="badge-pribox badge-open">Open</span>';
    if (!photos.length) {
        return `<div class="content-display-card"><div class="content-header"><div class="content-title">${escapeHtml(title)}</div><div class="badge-group">${accessBadge} ${viewOnceBadge}</div></div><div class="content-body-text">No photos available in this share.</div>${buildMetaFooter()}</div>`;
    }
    currentPhotos = photos;
    let galleryHTML = `<div class="content-display-card">
        <div class="content-header">
            <div class="content-title"><span class="material-icons">photo_library</span> ${escapeHtml(title)}</div>
            <div class="badge-group"><span class="badge-pribox badge-photos">${photos.length} photo${photos.length !== 1 ? 's' : ''}</span>${accessBadge}${viewOnceBadge}</div>
        </div>
        <div class="photo-gallery-pribox" id="photoGalleryGrid">`;
    photos.forEach((photo, idx) => {
        galleryHTML += `
            <div class="photo-card-pribox" data-photo-index="${idx}">
                <img src="${photo.url}" alt="${escapeHtml(photo.name)}" loading="lazy" onerror="this.src='https://via.placeholder.com/300?text=Error'">
                <div class="photo-info">
                    <div class="photo-meta">${photo.size ? photo.size : ''} ${photo.date ? photo.date : ''}</div>
                </div>
            </div>
        `;
    });
    galleryHTML += `</div>${buildMetaFooter()}</div>`;
    return galleryHTML;
}

function buildMetaFooter() {
    const views = linkData.views || 0;
    const unique = linkData.uniqueVisitors || 0;
    let meta = `<div class="meta-footer">`;
    if (linkData.expiration) meta += `<span>Expires: ${new Date(linkData.expiration).toLocaleString()}</span>`;
    meta += `<span>Viewed ${views} time${views !== 1 ? 's' : ''} · ${unique} unique visitor${unique !== 1 ? 's' : ''}</span>`;
    meta += `</div>`;
    return meta;
}

// Core display logic with unique visitor increment
async function displayContent() {
    if (isContentDisplayed) return;
    try {
        // First increment regular view count
        await incrementViews();
        
        // Handle unique visitor tracking
        const visitorId = getOrCreateVisitorId();
        if (!hasVisitorSeenLink(linkId)) {
            await incrementUniqueVisitor(linkId);
        }
        
        const contentDisplayDiv = document.getElementById('contentDisplay');
        const contentType = linkData.type || 'text';
        let html = '';
        if (contentType === 'mixed') {
            html = buildMixedHTML();
        } else if (contentType === 'photos') {
            html = buildPhotoHTML();
        } else {
            html = buildTextHTML();
        }
        contentDisplayDiv.innerHTML = html;
        document.getElementById('unlockSection').style.display = 'none';
        document.getElementById('contentSection').style.display = 'block';
        isContentDisplayed = true;
        if (document.getElementById('passwordInput')) document.getElementById('passwordInput').value = '';
        
        if ((contentType === 'mixed' && linkData.photos && linkData.photos.length) || contentType === 'photos') {
            attachPhotoEvents();
        }
        
        if (linkData.viewOnce && !linkData.isDestroyed) {
            startViewOnceCountdown();
        }
    } catch (err) { 
        console.error(err); 
        showError(`Display error: ${err.message}`); 
    }
}

function attachPhotoEvents() { /* same as original, kept for brevity */ 
    const gallery = document.getElementById('photoGalleryGrid');
    if (!gallery) return;
    document.querySelectorAll('.photo-card-pribox').forEach(card => {
        card.addEventListener('click', (e) => {
            const idx = parseInt(card.getAttribute('data-photo-index'));
            if (!isNaN(idx)) openPhotoModal(idx);
        });
    });
    const modal = document.getElementById('photoModal');
    const prevBtn = document.getElementById('prevPhotoBtn');
    const nextBtn = document.getElementById('nextPhotoBtn');
    if (prevBtn) prevBtn.onclick = (e) => { e.stopPropagation(); navigatePhoto(-1); };
    if (nextBtn) nextBtn.onclick = (e) => { e.stopPropagation(); navigatePhoto(1); };
    modal.onclick = (e) => { if (e.target === modal || e.target.classList.contains('modal-close')) closePhotoModal(); };
    document.addEventListener('keydown', (e) => {
        if (modal.classList.contains('active')) {
            if (e.key === 'Escape') closePhotoModal();
            else if (e.key === 'ArrowLeft') navigatePhoto(-1);
            else if (e.key === 'ArrowRight') navigatePhoto(1);
        }
    });
}

function openPhotoModal(idx) { /* same as original */ 
    if (!currentPhotos.length) return;
    currentPhotoIndex = Math.min(Math.max(0, idx), currentPhotos.length-1);
    const photo = currentPhotos[currentPhotoIndex];
    document.getElementById('modalImage').src = photo.url;
    document.getElementById('photoCounter').textContent = `${currentPhotoIndex+1} / ${currentPhotos.length}`;
    document.getElementById('photoModal').classList.add('active');
    document.body.style.overflow = 'hidden';
}
function navigatePhoto(d) { /* same */ 
    let newIdx = currentPhotoIndex + d;
    if (newIdx >= 0 && newIdx < currentPhotos.length) {
        currentPhotoIndex = newIdx;
        const photo = currentPhotos[currentPhotoIndex];
        document.getElementById('modalImage').src = photo.url;
        document.getElementById('photoCounter').textContent = `${currentPhotoIndex+1} / ${currentPhotos.length}`;
    }
}
function closePhotoModal() { /* same */ 
    document.getElementById('photoModal').classList.remove('active');
    document.body.style.overflow = '';
}

function resetToUnlock() { /* adapted to keep consistency */
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    document.getElementById('contentDisplay').innerHTML = '';
    document.getElementById('contentSection').style.display = 'none';
    document.getElementById('unlockSection').style.display = 'block';
    const passwordInput = document.getElementById('passwordInput');
    if (passwordInput) passwordInput.value = '';
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.style.display = 'none'; errorDiv.textContent = '';
    isContentDisplayed = false; isDestroyed = false;
    closePhotoModal();
    if (linkData && linkData.viewOnce && linkData.isDestroyed) {
        showError('This link has been destroyed (View Once mode already consumed).', true);
        document.getElementById('unlockSection').style.display = 'none';
        document.getElementById('contentSection').style.display = 'block';
        document.getElementById('contentDisplay').innerHTML = `<div class="destroyed-message"><span class="material-icons">warning</span><h3>Content Destroyed</h3><p>View Once content already viewed & destroyed.</p></div>`;
        const backBtn = document.getElementById('backToUnlockBtn');
        if(backBtn) backBtn.disabled = true;
        return;
    }
    if (linkData) showAccessMessage();
}

function showAccessMessage() {
    const openDiv = document.getElementById('openAccessMessage');
    const passDiv = document.getElementById('passwordAccessMessage');
    if (linkData.hasPassword) {
        openDiv.style.display = 'none';
        passDiv.style.display = 'block';
    } else {
        openDiv.style.display = 'block';
        passDiv.style.display = 'none';
    }
}

function isLinkAccessible(data) {
    if (!data) return false;
    if (data.status === 'pending') return false;
    if (data.isDestroyed) return false;
    if (data.expiration && new Date(data.expiration) < new Date()) return false;
    return true;
}

async function loadLink() {
    if (!linkId) { showError('Invalid link: missing content ID.', true); return; }
    document.getElementById('loading').style.display = 'block';
    try {
        await discoverShareDatabaseUrl();
        linkData = await getData(`shareLinks/${linkId}`);
        if (!linkData) { 
            showError('Link not found or has been deleted.', true); 
            return; 
        }
        if (!isLinkAccessible(linkData)) {
            let msg = 'Link is not accessible.';
            if (linkData.isDestroyed) msg = 'This link has been destroyed (View Once mode).';
            else if (linkData.expiration && new Date(linkData.expiration) < new Date()) msg = 'This link has expired.';
            showError(msg, true);
            document.getElementById('unlockSection').style.display = 'none';
            document.getElementById('contentSection').style.display = 'block';
            document.getElementById('contentDisplay').innerHTML = `<div class="destroyed-message"><span class="material-icons">gpp_bad</span><h3>Content Unavailable</h3><p>${escapeHtml(msg)}</p></div>`;
            document.getElementById('loading').style.display = 'none';
            return;
        }
        document.getElementById('loading').style.display = 'none';
        document.getElementById('unlockSection').style.display = 'block';
        showAccessMessage();
    } catch (err) { 
        console.error('Load error:', err);
        showError(`Unable to load content: ${err.message}`, true);
    } finally { 
        document.getElementById('loading').style.display = 'none'; 
    }
}

async function viewOpenContent() { 
    if(isContentDisplayed) return; 
    document.getElementById('loading').style.display='block'; 
    try{ 
        await displayContent(); 
    } catch(e){ 
        showError(e.message); 
    } finally{ 
        document.getElementById('loading').style.display='none'; 
    } 
}

async function verifyAndUnlock() {
    if(isContentDisplayed) return;
    const pwd = document.getElementById('passwordInput').value;
    if(!pwd){ showError('Please enter the password.'); return; }
    document.getElementById('loading').style.display='block'; 
    document.getElementById('unlockBtn').disabled=true;
    try{
        const enteredHash = await hashPassword(pwd);
        if(enteredHash === linkData.passwordHash){ 
            await displayContent(); 
        } else { 
            showError('Incorrect password. Try again.'); 
            document.getElementById('passwordInput').value=''; 
        }
    } catch(e){ 
        showError(`Error: ${e.message}`); 
    } finally { 
        document.getElementById('loading').style.display='none'; 
        document.getElementById('unlockBtn').disabled=false; 
    }
}

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function showError(msg, fatal=false){ 
    const errDiv=document.getElementById('errorMessage'); 
    errDiv.textContent=msg; 
    errDiv.style.display='block'; 
    if(fatal){ 
        const btn=document.getElementById('unlockBtn'); 
        if(btn)btn.disabled=true; 
        const viewBtn=document.getElementById('viewOpenContentBtn'); 
        if(viewBtn)viewBtn.disabled=true; 
    } 
    setTimeout(()=>{ 
        errDiv.style.display='none'; 
    },5000); 
}

function escapeHtml(t){ 
    if(!t) return ''; 
    const div=document.createElement('div'); 
    div.textContent=t; 
    return div.innerHTML; 
}

async function shareCurrentLink() {
    const currentUrl = window.location.href;
    const title = linkData?.title || 'PriBox Shared Content';
    if (navigator.share) {
        try {
            await navigator.share({ title: title, text: 'Check out this shared content on PriBox!', url: currentUrl });
            showTemporaryMessage('Sharing...', 'success');
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Share failed:', error);
                await fallbackCopyLink(currentUrl);
            }
        }
    } else {
        await fallbackCopyLink(currentUrl);
    }
}

async function fallbackCopyLink(url) {
    try {
        await navigator.clipboard.writeText(url);
        showTemporaryMessage('Link copied to clipboard!', 'info');
    } catch (err) {
        console.error('Copy failed:', err);
        showTemporaryMessage('Could not copy link. Please copy manually.', 'error');
    }
}

function showTemporaryMessage(msg, type = 'info') {
    const existingMsg = document.getElementById('tempShareMsg');
    if (existingMsg) existingMsg.remove();
    const msgDiv = document.createElement('div');
    msgDiv.id = 'tempShareMsg';
    msgDiv.className = `temp-message ${type}`;
    msgDiv.innerHTML = `<span class="material-icons">${type === 'success' ? 'check_circle' : (type === 'info' ? 'info' : 'error')}</span> ${msg}`;
    const buttonGroup = document.querySelector('.button-group');
    if (buttonGroup) {
        buttonGroup.parentNode.insertBefore(msgDiv, buttonGroup.nextSibling);
        setTimeout(() => msgDiv.remove(), 4000);
    }
}

function setupApkDownload() {
    const apkLink = document.getElementById('apkDownloadLink');
    apkLink.href = 'PriBox.apk';
    apkLink.download = 'PriBox.apk';
}

// Event binding
document.getElementById('unlockBtn')?.addEventListener('click', verifyAndUnlock);
document.getElementById('passwordInput')?.addEventListener('keypress', (e) => { if(e.key === 'Enter') verifyAndUnlock(); });
document.getElementById('viewOpenContentBtn')?.addEventListener('click', viewOpenContent);
document.getElementById('backToUnlockBtn')?.addEventListener('click', resetToUnlock);
document.getElementById('shareLinkBtn')?.addEventListener('click', shareCurrentLink);

// Initialize
loadLink();
setupApkDownload();