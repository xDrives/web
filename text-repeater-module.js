// Text Repeater Module - Clean version without sidebar, saved patterns, and download
class TextRepeaterModule {
    constructor() {
        this.currentPattern = null;
        this.selectedPattern = 'normal';
    }

    async initTextRepeater() {
        console.log('Text Repeater module initialized');
        return true;
    }

    async render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Text repeater container not found:', containerId);
            return;
        }

        console.log('Rendering text repeater module');
        await this.initTextRepeater();
        container.innerHTML = this.getHTML();
        this.setupEventListeners();
        this.initControls();
        this.updatePatternButtonsActive(this.selectedPattern);
    }

    getHTML() {
        const patterns = [
            { id: 'normal', name: 'Normal', icon: 'straighten' },
            { id: 'wave', name: 'Wave', icon: 'show_chart' },
            { id: 'triangle', name: 'Triangle', icon: 'trending_up' },
            { id: 'square', name: 'Square', icon: 'crop_square' },
            { id: 'staircase', name: 'Staircase', icon: 'call_made' },
            { id: 'random', name: 'Random', icon: 'shuffle' }
        ];

        const patternButtonsHtml = patterns.map(p => `
            <button type="button" class="pattern-btn ${this.selectedPattern === p.id ? 'active' : ''}" data-pattern="${p.id}">
                <span class="material-icons">${p.icon}</span>
                <span class="pattern-btn-name">${p.name}</span>
            </button>
        `).join('');

        return `
            <div class="text-repeater-module">
                <!-- Header -->
                <div class="module-card">
                    <div class="module-icon" style="color: var(--primary);">
                        <span class="material-icons">repeat</span>
                    </div>
                    <div class="module-info">
                        <div class="module-title">Text Repeater</div>
                        <div class="module-description">Create patterned text repetitions with dynamic spacing styles</div>
                    </div>
                </div>

                <!-- Main Content -->
                <div class="repeater-main">
                    <!-- Input Card -->
                    <div class="repeater-card">
                        <div class="card-title">
                            <span class="material-icons">text_fields</span>
                            Input Settings
                        </div>
                        
                        <form class="repeater-form" id="generatorForm">
                            <div class="form-group">
                                <label class="form-label" for="inputText">Base Text</label>
                                <input type="text" id="inputText" class="form-input" 
                                    placeholder="Enter text to repeat..." maxlength="60" value="Hello World!">
                                <div class="form-help">Text that will be repeated with pattern spacing</div>
                            </div>

                            <div class="form-row">
                                <div class="form-group">
                                    <label class="form-label" for="repeatCount">Repeat Count</label>
                                    <div class="number-input-group">
                                        <input type="number" id="repeatCount" class="form-input" 
                                            min="1" max="1000" value="50">
                                        <div class="number-controls">
                                            <button type="button" class="number-btn" id="incCount">
                                                <span class="material-icons">expand_less</span>
                                            </button>
                                            <button type="button" class="number-btn" id="decCount">
                                                <span class="material-icons">expand_more</span>
                                            </button>
                                        </div>
                                    </div>
                                    <div class="form-help">Number of repetitions (1-1000)</div>
                                </div>

                                <div class="form-group">
                                    <label class="form-label">Amplitude Control</label>
                                    <div class="slider-container">
                                        <div class="slider-track-custom">
                                            <div class="slider-fill-custom" id="sliderFill"></div>
                                            <input type="range" id="amplitudeSlider" class="slider-input" 
                                                min="1" max="20" value="5">
                                        </div>
                                        <div class="slider-values">
                                            <span>Min (1)</span>
                                            <span>Amplitude: <span id="amplitudeValue">5</span></span>
                                            <span>Max (20)</span>
                                        </div>
                                    </div>
                                    <div class="form-help">Controls the intensity of spacing pattern</div>
                                </div>
                            </div>

                            <!-- Pattern Selection Buttons -->
                            <div class="form-group">
                                <label class="form-label">Pattern Style</label>
                                <div class="pattern-buttons-grid" id="patternButtonsGrid">
                                    ${patternButtonsHtml}
                                </div>
                                <div class="form-help">Click any pattern to select — visual preview updates instantly</div>
                            </div>

                            <div class="pattern-preview-container">
                                <label class="form-label">Pattern Preview</label>
                                <div class="pattern-preview" id="patternPreview"></div>
                            </div>

                            <div class="form-actions">
                                <button type="submit" class="btn btn-primary" id="generateBtn">
                                    <i class="fas fa-gears"></i> Generate Pattern
                                </button>
                                <button type="button" class="btn btn-secondary" id="copyOutputBtn">
                                    <i class="fas fa-copy"></i> Copy
                                </button>
                                <button type="button" class="btn btn-warning" id="clearOutputBtn">
                                    <i class="fas fa-broom"></i> Clear
                                </button>
                            </div>
                        </form>
                    </div>

                    <!-- Output Card -->
                    <div class="repeater-card">
                        <div class="card-title">
                            <span class="material-icons">output</span>
                            Generated Output
                            <span class="output-stats" id="outputStats">0 lines, 0 characters</span>
                        </div>
                        
                        <div class="output-container" id="outputContainer">
                            <div class="output-placeholder">
                                <span class="material-icons">code</span>
                                <p>Your generated text will appear here</p>
                                <small>Select a pattern and click Generate</small>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    initControls() {
        this.updateSliderFill();
        this.updatePatternPreview();
        this.updateCountDisplay();
    }

    setupEventListeners() {
        // Form submission
        const generatorForm = document.getElementById('generatorForm');
        if (generatorForm) {
            generatorForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.generatePattern();
            });
        }

        // Amplitude slider
        const amplitudeSlider = document.getElementById('amplitudeSlider');
        if (amplitudeSlider) {
            amplitudeSlider.addEventListener('input', () => {
                const amplitudeValue = document.getElementById('amplitudeValue');
                if (amplitudeValue) amplitudeValue.textContent = amplitudeSlider.value;
                this.updateSliderFill();
                this.updatePatternPreview();
            });
        }

        // Repeat count controls
        const repeatCount = document.getElementById('repeatCount');
        if (repeatCount) {
            repeatCount.addEventListener('input', () => this.updateCountDisplay());
        }

        document.getElementById('incCount')?.addEventListener('click', () => {
            const input = document.getElementById('repeatCount');
            if (parseInt(input.value) < 1000) {
                input.value = parseInt(input.value) + 1;
                this.updateCountDisplay();
            }
        });

        document.getElementById('decCount')?.addEventListener('click', () => {
            const input = document.getElementById('repeatCount');
            if (parseInt(input.value) > 1) {
                input.value = parseInt(input.value) - 1;
                this.updateCountDisplay();
            }
        });

        // Pattern Buttons
        this.setupPatternButtons();

        // Buttons
        document.getElementById('generateBtn')?.addEventListener('click', () => this.generatePattern());
        document.getElementById('copyOutputBtn')?.addEventListener('click', () => this.copyToClipboard());
        document.getElementById('clearOutputBtn')?.addEventListener('click', () => this.clearOutput());

        // Input text enter key
        document.getElementById('inputText')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.generatePattern();
        });
    }

    setupPatternButtons() {
        const buttons = document.querySelectorAll('.pattern-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const patternId = btn.getAttribute('data-pattern');
                if (patternId) {
                    this.selectedPattern = patternId;
                    this.updatePatternButtonsActive(patternId);
                    this.updatePatternPreview();
                }
            });
        });
    }

    updatePatternButtonsActive(activePatternId) {
        const buttons = document.querySelectorAll('.pattern-btn');
        buttons.forEach(btn => {
            const patternId = btn.getAttribute('data-pattern');
            if (patternId === activePatternId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    updateSliderFill() {
        const slider = document.getElementById('amplitudeSlider');
        const fill = document.getElementById('sliderFill');
        if (slider && fill) {
            const percent = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
            fill.style.width = `${percent}%`;
        }
    }

    updateCountDisplay() {
        const countInput = document.getElementById('repeatCount');
        if (countInput) {
            const value = countInput.value;
            if (parseInt(value) > 1000) countInput.value = 1000;
            if (parseInt(value) < 1) countInput.value = 1;
        }
    }

    updatePatternPreview() {
        const pattern = this.selectedPattern;
        const amplitude = parseInt(document.getElementById('amplitudeSlider')?.value || 5);
        const previewContainer = document.getElementById('patternPreview');
        
        if (!previewContainer) return;
        
        previewContainer.innerHTML = '';
        const barCount = 30;
        
        for (let i = 0; i < barCount; i++) {
            const bar = document.createElement('div');
            bar.className = 'preview-bar';
            
            let height = 0;
            switch(pattern) {
                case 'wave':
                    height = Math.abs(Math.floor(amplitude * Math.sin(i / 1.8))) / amplitude * 80;
                    break;
                case 'triangle':
                    height = Math.abs(amplitude - (i % (amplitude * 2))) / amplitude * 80;
                    break;
                case 'square':
                    height = i % 4 < 2 ? 80 : 20;
                    break;
                case 'staircase':
                    height = (i % amplitude) / amplitude * 80;
                    break;
                case 'random':
                    height = Math.random() * 80;
                    break;
                default:
                    height = 0;
            }
            
            bar.style.height = `${Math.max(4, height)}%`;
            bar.style.width = `${100 / barCount}%`;
            previewContainer.appendChild(bar);
        }
    }

    calculateSpacing(index, pattern, amplitude) {
        switch(pattern) {
            case 'wave': 
                return ' '.repeat(Math.abs(Math.floor(amplitude * Math.sin(index / 2))));
            case 'triangle': 
                return ' '.repeat(Math.abs(amplitude - (index % (amplitude * 2))));
            case 'square': 
                return ' '.repeat(index % 4 < 2 ? 0 : amplitude);
            case 'staircase': 
                return ' '.repeat(index % amplitude);
            case 'random': 
                return ' '.repeat(Math.floor(Math.random() * amplitude));
            default: 
                return '';
        }
    }

    generatePattern() {
        const text = document.getElementById('inputText')?.value.trim();
        let count = parseInt(document.getElementById('repeatCount')?.value) || 1;
        const pattern = this.selectedPattern;
        const amplitude = parseInt(document.getElementById('amplitudeSlider')?.value);
        
        if (!text) {
            this.showError('Please enter some text to repeat');
            return;
        }
        
        if (count > 1000) count = 1000;
        
        let output = '';
        for (let i = 0; i < count; i++) {
            const spaces = this.calculateSpacing(i, pattern, amplitude);
            output += spaces + text + '\n';
        }
        
        const outputContainer = document.getElementById('outputContainer');
        if (outputContainer) {
            outputContainer.innerHTML = `<pre class="generated-output">${this.escapeHtml(output)}</pre>`;
        }
        
        const lines = output.split('\n').filter(l => l !== '').length;
        const chars = output.replace(/\n/g, '').length;
        const outputStats = document.getElementById('outputStats');
        if (outputStats) {
            outputStats.textContent = `${lines} lines, ${chars} characters`;
        }
        
        this.currentPattern = {
            text, count, pattern, amplitude, output,
            timestamp: new Date().toISOString()
        };
        
        this.showSuccess('Pattern generated successfully!');
    }

    copyToClipboard() {
        const output = document.querySelector('#outputContainer pre');
        const copyBtn = document.getElementById('copyOutputBtn');
        
        if (!output || output.textContent.includes('Your generated text will appear here')) {
            this.showError('No output to copy. Generate a pattern first!');
            return;
        }
        
        navigator.clipboard.writeText(output.textContent).then(() => {
            // Success feedback
            this.showSuccess('✓ Copied to clipboard!');
            
            // Visual feedback on button
            if (copyBtn) {
                const originalHTML = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                copyBtn.style.background = 'var(--primary)';
                copyBtn.style.borderColor = 'var(--primary)';
                copyBtn.style.color = 'white';
                
                setTimeout(() => {
                    copyBtn.innerHTML = originalHTML;
                    copyBtn.style.background = '';
                    copyBtn.style.borderColor = '';
                    copyBtn.style.color = '';
                }, 2000);
            }
        }).catch(() => {
            this.showError('Failed to copy. Please try again.');
        });
    }

    showSuccess(message) {
        const outputContainer = document.getElementById('outputContainer');
        if (!outputContainer) return;
        
        // Remove any existing message
        const existingMsg = outputContainer.querySelector('.temp-message');
        if (existingMsg) existingMsg.remove();
        
        // Create success message
        const msgDiv = document.createElement('div');
        msgDiv.className = 'temp-message success-message';
        msgDiv.innerHTML = `<span class="material-icons">check_circle</span> ${message}`;
        msgDiv.style.cssText = `
            position: absolute;
            bottom: 10px;
            right: 10px;
            background: rgba(16, 185, 129, 0.95);
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 100;
            animation: slideIn 0.3s ease;
            font-family: system-ui, -apple-system, sans-serif;
        `;
        
        outputContainer.style.position = 'relative';
        outputContainer.appendChild(msgDiv);
        
        setTimeout(() => msgDiv.remove(), 2000);
    }

    showError(message) {
        const outputContainer = document.getElementById('outputContainer');
        if (!outputContainer) return;
        
        // Remove any existing message
        const existingMsg = outputContainer.querySelector('.temp-message');
        if (existingMsg) existingMsg.remove();
        
        // Create error message
        const msgDiv = document.createElement('div');
        msgDiv.className = 'temp-message error-message';
        msgDiv.innerHTML = `<span class="material-icons">error</span> ${message}`;
        msgDiv.style.cssText = `
            position: absolute;
            bottom: 10px;
            right: 10px;
            background: rgba(239, 68, 68, 0.95);
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            gap: 8px;
            z-index: 100;
            animation: slideIn 0.3s ease;
            font-family: system-ui, -apple-system, sans-serif;
        `;
        
        outputContainer.style.position = 'relative';
        outputContainer.appendChild(msgDiv);
        
        setTimeout(() => msgDiv.remove(), 3000);
    }

    clearOutput() {
        const outputContainer = document.getElementById('outputContainer');
        if (outputContainer) {
            outputContainer.innerHTML = `
                <div class="output-placeholder">
                    <span class="material-icons">code</span>
                    <p>Your generated text will appear here</p>
                    <small>Select a pattern and click Generate</small>
                </div>
            `;
        }
        
        const outputStats = document.getElementById('outputStats');
        if (outputStats) {
            outputStats.textContent = '0 lines, 0 characters';
        }
        
        this.currentPattern = null;
        this.showSuccess('Output cleared');
    }

    escapeHtml(str) {
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }
}

// Initialize text repeater module
const textRepeaterModule = new TextRepeaterModule();
window.textRepeaterModule = textRepeaterModule;