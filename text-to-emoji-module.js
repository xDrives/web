// Text to Emoji Art Module - Redesigned with Pattern Button Style
class TextToEmojiModule {
    constructor() {
        this.storageKey = 'emoji-art-data';
        this.selectedStyle = 'redHeart';
        this.isCustomStyle = false;
        this.customFill = '😀';
        this.customEmpty = '🤍';
        this.emojiPatterns = this.getEmojiPatterns();
        this.init();
    }

    init() {
        console.log('Text to Emoji Module initialized');
    }

    // Render the emoji art interface
    render(containerId) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error('Emoji art container not found:', containerId);
            return;
        }

        container.innerHTML = this.getEmojiArtHTML();
        this.attachEventListeners();
        this.updateStylePreview();
    }

    getEmojiArtHTML() {
        const styles = [
            { id: 'heart', name: 'Heart', icon: 'favorite', fill: '❤️', empty: '🖤', desc: 'Red & Black' },
            { id: 'dots', name: 'Dots', icon: 'lens', fill: '🔵', empty: '⚫', desc: 'Blue & Black' },
            { id: 'emptyDots', name: 'Empty Dots', icon: 'panorama_fish_eye', fill: '◯', empty: '⚫', desc: 'Empty & Black' },
            { id: 'custom', name: 'Custom', icon: 'edit', fill: '🎨', empty: '✨', desc: 'Your own emojis' }
        ];

        const styleButtonsHtml = styles.map(s => `
            <button type="button" class="style-btn ${this.selectedStyle === s.id ? 'active' : ''}" data-style="${s.id}" data-fill="${s.fill}" data-empty="${s.empty}">
                <span class="material-icons">${s.icon}</span>
                <span class="style-btn-name">${s.name}</span>
                <span class="style-btn-desc">${s.desc}</span>
            </button>
        `).join('');

        return `
            <div class="text-to-emoji-module">
                <!-- Header -->
                <div class="module-card">
                    <div class="module-icon" style="color: var(--primary);">
                        <span class="material-icons">emoji_emotions</span>
                    </div>
                    <div class="module-info">
                        <div class="module-title">Emoji Art Generator</div>
                        <div class="module-description">Convert text to stylish emoji-based pixel art</div>
                    </div>
                </div>

                <!-- Main Content -->
                <div class="emoji-main">
                    <!-- Input Card -->
                    <div class="emoji-card">
                        <div class="card-title">
                            <span class="material-icons">emoji_emotions</span>
                            Input Settings
                        </div>
                        
                        <form class="emoji-form" id="emojiGeneratorForm">
                            <div class="form-group">
                                <label class="form-label" for="textInput">Base Text: <span id="charCount">5</span>/20</label>
                                <input type="text" id="textInput" class="form-input" 
                                    placeholder="Enter text to convert (A-Z, 0-9)..." maxlength="20" value="HELLO">
                                <div class="form-help">Letters, numbers, and basic symbols only</div>
                            </div>

                            <!-- Style Selection Buttons -->
                            <div class="form-group">
                                <label class="form-label">Style Selection</label>
                                <div class="style-buttons-grid" id="styleButtonsGrid">
                                    ${styleButtonsHtml}
                                </div>
                                <div class="form-help">Click any style to select — custom style allows your own emojis</div>
                            </div>

                            <!-- Custom Style Inputs -->
                            <div class="custom-style-container" id="customStyleContainer" style="display: none;">
                                <div class="form-row">
                                    <div class="form-group">
                                        <label class="form-label" for="customFillEmoji">Fill Emoji</label>
                                        <input type="text" id="customFillEmoji" class="form-input" 
                                            placeholder="😀" maxlength="2" value="${this.customFill}">
                                        <div class="form-help">Emoji for filled pixels (the "colored" parts)</div>
                                    </div>
                                    <div class="form-group">
                                        <label class="form-label" for="customEmptyEmoji">Empty Emoji</label>
                                        <input type="text" id="customEmptyEmoji" class="form-input" 
                                            placeholder="🤍" maxlength="2" value="${this.customEmpty}">
                                        <div class="form-help">Emoji for empty pixels (the "background" parts)</div>
                                    </div>
                                </div>
                                <div class="custom-preview" id="customPreview">
                                    <span>Preview: </span>
                                    <span id="customPreviewFill">${this.customFill}</span>
                                    <span id="customPreviewArrow">→</span>
                                    <span id="customPreviewEmpty">${this.customEmpty}</span>
                                </div>
                            </div>

                            <div class="style-preview-container">
                                <label class="form-label">Style Preview</label>
                                <div class="style-preview" id="stylePreview"></div>
                            </div>

                            <div class="form-actions">
                                <button type="submit" class="btn btn-primary" id="generateEmojiBtn">
                                    <i class="fas fa-gears"></i> Generate Art
                                </button>
                                <button type="button" class="btn btn-neutral" id="copyEmojiBtn">
                                    <i class="fas fa-copy"></i> Copy
                                </button>
                                <button type="button" class="btn btn-warning" id="clearEmojiBtn">
                                    <i class="fas fa-broom"></i> Clear
                                </button>
                            </div>
                        </form>
                    </div>

                    <!-- Output Card -->
                    <div class="emoji-card">
                        <div class="card-title">
                            <span class="material-icons">output</span>
                            Generated Output
                            <span class="output-stats" id="emojiOutputStats">0 lines, 0 characters</span>
                        </div>
                        
                        <div class="output-container" id="emojiOutputContainer">
                            <div class="output-placeholder">
                                <span class="material-icons">emoji_emotions</span>
                                <p>Your emoji art will appear here</p>
                                <small>Select a style and click Generate</small>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    attachEventListeners() {
        // Form submission
        const generatorForm = document.getElementById('emojiGeneratorForm');
        if (generatorForm) {
            generatorForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.generateEmojiArt();
            });
        }

        // Style Buttons
        this.setupStyleButtons();

        // Custom style inputs
        const customFill = document.getElementById('customFillEmoji');
        const customEmpty = document.getElementById('customEmptyEmoji');
        
        if (customFill) {
            customFill.addEventListener('input', () => {
                this.customFill = customFill.value || '😀';
                document.getElementById('customPreviewFill').textContent = this.customFill;
                if (this.selectedStyle === 'custom') {
                    this.updateStylePreview();
                }
            });
        }
        
        if (customEmpty) {
            customEmpty.addEventListener('input', () => {
                this.customEmpty = customEmpty.value || '▫️';
                document.getElementById('customPreviewEmpty').textContent = this.customEmpty;
                if (this.selectedStyle === 'custom') {
                    this.updateStylePreview();
                }
            });
        }

        // Buttons
        document.getElementById('generateEmojiBtn')?.addEventListener('click', () => this.generateEmojiArt());
        document.getElementById('copyEmojiBtn')?.addEventListener('click', () => this.copyToClipboard());
        document.getElementById('clearEmojiBtn')?.addEventListener('click', () => this.clearOutput());

        // Input text enter key
        document.getElementById('textInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.generateEmojiArt();
        });

        // Character count
        document.getElementById('textInput')?.addEventListener('input', (e) => {
            let charCount = e.target.value.length;
            if (charCount > 20) {
                e.target.value = e.target.value.slice(0, 20);
                charCount = 20;
            }
            document.getElementById('charCount').textContent = charCount;
        });

        // Double click to load sample
        document.getElementById('textInput')?.addEventListener('dblclick', () => {
            if (!document.getElementById('textInput').value) {
                document.getElementById('textInput').value = 'HELLO';
                document.getElementById('charCount').textContent = 5;
                this.generateEmojiArt();
            }
        });
    }

    setupStyleButtons() {
        const buttons = document.querySelectorAll('.style-btn');
        const customContainer = document.getElementById('customStyleContainer');
        
        buttons.forEach(btn => {
            btn.addEventListener('click', () => {
                const styleId = btn.getAttribute('data-style');
                if (styleId) {
                    this.selectedStyle = styleId;
                    this.isCustomStyle = (styleId === 'custom');
                    
                    // Show/hide custom inputs
                    if (customContainer) {
                        customContainer.style.display = this.isCustomStyle ? 'block' : 'none';
                    }
                    
                    this.updateStyleButtonsActive(styleId);
                    this.updateStylePreview();
                }
            });
        });
    }

    updateStyleButtonsActive(activeStyleId) {
        const buttons = document.querySelectorAll('.style-btn');
        buttons.forEach(btn => {
            const styleId = btn.getAttribute('data-style');
            if (styleId === activeStyleId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    updateStylePreview() {
        const previewContainer = document.getElementById('stylePreview');
        if (!previewContainer) return;

        let fill, empty;
        
        if (this.selectedStyle === 'custom') {
            fill = this.customFill || '😀';
            empty = this.customEmpty || '🤍';
        } else {
            const style = this.getStyleEmojis()[this.selectedStyle];
            if (!style) return;
            fill = style.fill;
            empty = style.empty;
        }

        // Create a preview grid showing the style
        const previewGrid = document.createElement('div');
        previewGrid.className = 'style-preview-grid';
        
        const pattern = [
            [1, 1, 1, 1, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 1, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 1, 1, 1, 1]
        ];
        
        for (let row of pattern) {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'preview-row';
            for (let cell of row) {
                const cellSpan = document.createElement('span');
                cellSpan.className = 'preview-cell';
                cellSpan.textContent = cell === 1 ? fill : empty;
                rowDiv.appendChild(cellSpan);
            }
            previewGrid.appendChild(rowDiv);
        }
        
        previewContainer.innerHTML = '';
        previewContainer.appendChild(previewGrid);
        
        // Add style info
        const infoDiv = document.createElement('div');
        infoDiv.className = 'style-info';
        infoDiv.innerHTML = `<small>Fill: ${fill} | Empty: ${empty}</small>`;
        previewContainer.appendChild(infoDiv);
    }

    getStyleEmojis() {
        return {
            heart:    { fill: '❤️', empty: '🖤' },
            squares:    { fill: '🟨', empty: '⬛' },
            dots:       { fill: '🔵', empty: '⚫' },
            emptyDots:       { fill: '◯', empty: '⚫' }
        };
    }

    getCurrentStyle() {
        if (this.selectedStyle === 'custom') {
            return {
                fill: this.customFill || '😀',
                empty: this.customEmpty || '🤍'
            };
        }
        return this.getStyleEmojis()[this.selectedStyle] || { fill: '❤️', empty: '🖤' };
    }

    getEmojiPatterns() {
        return {
            // Numbers
            '0': [
                "110011",
                "100001",
                "001100",
                "001100",
                "001100",
                "001100",
                "100001",
                "110011"
            ],
            '1': [
                "1100111",
                "000011",
                "110011",
                "110011",
                "110011",
                "110011",
                "100001",
                "100001"
            ],
            '2': [
                "100001",
                "001100",
                "001100",
                "111000",
                "110011",
                "100111",
                "000000",
                "000000"
            ],
            '3': [
                "100000",
                "000000",
                "111100",
                "100000",
                "100000",
                "111100",
                "000000",
                "100000"
            ],
            '4': [
                "111100",
                "001100",
                "001100",
                "001100",
                "000000",
                "111100",
                "111100",
                "111100"
            ],
            '5': [
                "000000",
                "000000",
                "001111",
                "000000",
                "000000",
                "111100",
                "111100",
                "000001"
            ],
            '6': [
                "100001",
                "001100",
                "001111",
                "001111",
                "000001",
                "001100",
                "001100",
                "100001"
            ],
            '7': [
                "000000",
                "000000",
                "111100",
                "111001",
                "110011",
                "100111",
                "001111",
                "001111"
            ],
            '8': [
                "100001",
                "001100",
                "001100",
                "000000",
                "000000",
                "001100",
                "001100",
                "100001"
            ],
            '9': [
                "100001",
                "000000",
                "001100",
                "001100",
                "100000",
                "111100",
                "011100",
                "100001"
            ],

            // Uppercase Letters
            'A': [
                "100001",
                "000000",
                "001100",
                "001100",
                "000000",
                "000000",
                "001100",
                "001100"
            ],
            'B': [
                "000001",
                "000000",
                "001100",
                "000001",
                "000001",
                "001100",
                "000000",
                "000001"
            ],
            'C': [
                "100001",
                "000000",
                "001100",
                "001111",
                "001111",
                "001100",
                "000000",
                "100001"
            ],
            'D': [
                "000001",
                "000000",
                "001100",
                "001100",
                "001100",
                "001100",
                "000000",
                "000001"
            ],
            'E': [
                "000000",
                "000000",
                "001111",
                "000000",
                "000000",
                "001111",
                "000000",
                "000000"
            ],
            'F': [
                "000000",
                "000000",
                "001111",
                "000001",
                "000001",
                "001111",
                "001111",
                "001111"
            ],
            'G': [
                "100001",
                "000000",
                "001100",
                "001111",
                "001000",
                "001000",
                "000010",
                "100010"
            ],
            'H': [
                "001100",
                "001100",
                "001100",
                "000000",
                "000000",
                "001100",
                "001100",
                "001100"
            ],
            'I': [
                "100001",
                "100001",
                "110011",
                "110011",
                "110011",
                "110011",
                "100001",
                "100001"
            ],
            'J': [
                "110000",
                "110000",
                "111001",
                "111001",
                "111001",
                "001001",
                "000001",
                "100011"
            ],
            'K': [
                "001100",
                "001100",
                "001001",
                "000011",
                "000011",
                "001001",
                "001100",
                "001100"
            ],
            'L': [
                "001111",
                "001111",
                "001111",
                "001111",
                "001111",
                "001111",
                "000001",
                "000001"
            ],
            'M': [
                "011110",
                "001100",
                "000000",
                "000000",
                "001100",
                "001100",
                "001100",
                "001100"
            ],
            'N': [
                "001100",
                "000100",
                "000100",
                "000000",
                "000000",
                "001000",
                "001000",
                "001100"
            ],
            'O': [
                "100001",
                "000000",
                "001100",
                "001100",
                "001100",
                "001100",
                "000000",
                "100001"
            ],
            'P': [
                "000000",
                "000000",
                "001100",
                "001100",
                "000000",
                "001111",
                "001111",
                "001111"
            ],
            'Q': [
                "100001",
                "000000",
                "001100",
                "001100",
                "001100",
                "001001",
                "000000",
                "100010"
            ],
            'R': [
                "000001",
                "000000",
                "001100",
                "001100",
                "000001",
                "001001",
                "001100",
                "001100"
            ],
            'S': [
                "100000",
                "000000",
                "001111",
                "000001",
                "100000",
                "111000",
                "000000",
                "000001"
            ],
            'T': [
                "000000",
                "000000",
                "110011",
                "110011",
                "110011",
                "110011",
                "110011",
                "110011"
            ],
            'U': [
                "001100",
                "001100",
                "001100",
                "001100",
                "001100",
                "001100",
                "000000",
                "100001"
            ],
            'V': [
                "001100",
                "001100",
                "001100",
                "001100",
                "001100",
                "001101",
                "100001",
                "110011"
            ],
            'W': [
                "001100",
                "001100",
                "001100",
                "001100",
                "000000",
                "000000",
                "001100",
                "011110"
            ],
            'X': [
                "001100",
                "001100",
                "100001",
                "110011",
                "110011",
                "100001",
                "001100",
                "001100",
            ],
            'Y': [
                "001100",
                "001100",
                "000000",
                "100001",
                "110011",
                "110011",
                "110011",
                "110011"
            ],
            'Z': [
                "000000",
                "000000",
                "111000",
                "110001",
                "100011",
                "000111",
                "000000",
                "000000"
            ],

            // Lowercase Letters
            'a': [
                "111111",
                "100000",
                "000000",
                "001100",
                "001100",
                "000001",
                "100000",
                "111100"
            ],
            'b': [
                "001111",
                "001111",
                "001111",
                "000001",
                "001100",
                "001100",
                "000000",
                "000000"
            ],
            'c': [
                "100001",
                "000000",
                "001100",
                "001111",
                "001111",
                "001100",
                "000000",
                "100001"
            ],
            'd': [
                "111100",
                "111100",
                "100000",
                "001100",
                "001100",
                "001100",
                "000000",
                "000000"
            ],
            'e': [
                "100011",
                "000000",
                "001100",
                "001100",
                "000000",
                "001111",
                "000000",
                "100001"
            ],
            'f': [
                "110000",
                "110000",
                "110011",
                "000000",
                "110011",
                "110011",
                "110011",
                "110011"
            ],
            'g': [
                "100001",
                "000000",
                "001100",
                "001100",
                "100000",
                "111100",
                "000000",
                "100000"
            ],
            'h': [
                "001111",
                "001111",
                "001111",
                "000001",
                "001000",
                "001100",
                "001100",
                "001100"
            ],
            'i': [
                "110011",
                "111111",
                "100011",
                "110011",
                "110011",
                "110011",
                "100001",
                "100001"
            ],
            'j': [
                "111001",
                "111111",
                "110000",
                "111001",
                "111001",
                "111001",
                "010001",
                "100011"
            ],
            'k': [
                "001111",
                "001100",
                "001001",
                "000011",
                "000011",
                "001001",
                "001100",
                "001100"
            ],
            'l': [
                "111111",
                "100011",
                "110011",
                "110011",
                "110011",
                "110011",
                "100001",
                "100001"
            ],
            'm': [
                "001111",
                "000001",
                "001010",
                "001010",
                "001010",
                "001010",
                "001010",
                "001010"
            ],
            'n': [
                "000111",
                "100001",
                "100110",
                "100110",
                "100110",
                "100110",
                "100110",
                "100110"
            ],
            'o': [
                "111111",
                "100001",
                "001100",
                "001100",
                "001100",
                "001100",
                "100001",
                "111111"
            ],
            'p': [
                "111111",
                "000001",
                "001101",
                "001101",
                "000011",
                "001111",
                "001111",
                "001111"
            ],
            'q': [
                "111111",
                "100000",
                "101100",
                "101100",
                "110000",
                "111100",
                "111100",
                "111100"
            ],
            'r': [
                "111111",
                "000111",
                "100001",
                "100111",
                "100111",
                "100111",
                "100111",
                "100111"
            ],
            's': [
                "111111",
                "100001",
                "000000",
                "001111",
                "100001",
                "111100",
                "000000",
                "100001"
            ],
            't': [
                "100111",
                "100111",
                "000001",
                "100111",
                "100111",
                "100110",
                "100100",
                "110011"
            ],
            'u': [
                "111111",
                "001100",
                "001100",
                "001100",
                "001100",
                "001100",
                "000000",
                "100001"
            ],
            'v': [
                "111111",
                "001100",
                "001100",
                "001100",
                "001100",
                "001100",
                "100001",
                "110011"
            ],
            'w': [
                "111111",
                "011110",
                "011110",
                "011010",
                "011010",
                "011010",
                "011010",
                "100100"
            ],
            'x': [
                "001100",
                "001100",
                "100001",
                "110011",
                "110011",
                "100001",
                "001100",
                "001100"
            ],
            'y': [
                "111111",
                "001100",
                "001100",
                "001100",
                "000000",
                "111100",
                "111000",
                "000001"
            ],
            'z': [
                "111111",
                "000000",
                "000000",
                "111100",
                "110011",
                "001111",
                "000000",
                "000000"
            ],

            // Special Characters
            '!': [
                "110011",
                "110011",
                "110011",
                "110011",
                "110011",
                "110011",
                "111111",
                "110011",
            ],
            '?': [
                "100011",
                "000001",
                "111001",
                "110011",
                "100111",
                "100111",
                "111111",
                "100111"
            ],
            '.': [
                "111111",
                "111111",
                "111111",
                "111111",
                "111111",
                "100011",
                "100011",
                "111111"
            ],
            ',': [
                "111111",
                "111111",
                "111111",
                "111111",
                "111001",
                "110011",
                "100111",
                "111111"
            ],
            ':': [
                "111111",
                "110011",
                "110011",
                "111111",
                "111111",
                "110011",
                "110011",
                "111111"
            ],
            ';': [
                "111111",
                "111001",
                "111001",
                "111111",
                "111111",
                "111001",
                "110011",
                "100111"
            ],
            '@': [
                "100001",
                "011110",
                "010000",
                "010100",
                "010100",
                "010000",
                "011111",
                "100000"
            ],
            '#': [
                "101101",
                "000000",
                "000000",
                "101101",
                "101101",
                "000000",
                "000000",
                "101101"
            ],
            '$': [
                "110011",
                "000000",
                "010010",
                "000011",
                "110000",
                "010010",
                "000000",
                "110011"
            ],
            '%': [
                "111111",
                "001111",
                "001100",
                "111001",
                "110011",
                "100111",
                "001100",
                "111100",
                "111111"
            ],
            '&': [
                "100001",
                "001100",
                "001100",
                "100001",
                "101000",
                "001100",
                "001100",
                "000010",
            ],
            '*': [
                "110101",
                "100101",
                "110011",
                "110011",
                "101001",
                "110110",
                "111111",
                "111111"
            ],
            '+': [
                "111111",
                "110011",
                "110011",
                "000000",
                "000000",
                "110011",
                "110011",
                "111111"
            ],
            '-': [
                "111111",
                "111111",
                "000000",
                "000000",
                "111111",
                "111111",
                "111111",
                "111111"
            ],
            '=': [
                "111111",
                "000000",
                "000000",
                "111111",
                "000000",
                "000000",
                "111111",
                "111111"
            ],
            '/': [
                "111111",
                "111110",
                "111100",
                "111001",
                "110011",
                "100111",
                "011111",
                "111111"
            ],
            '|': [
                "111111",
                "110011",
                "110011",
                "110011",
                "110011",
                "110011",
                "110011",
                "111111",
            ],
            '(': [
                "111100",
                "110011",
                "100111",
                "001111",
                "001111",
                "100111",
                "110011",
                "111100",
            ],
            ')': [
                "001111",
                "110011",
                "111001",
                "111100",
                "111100",
                "111001",
                "110011",
                "001111"
            ],
            '[': [
                "000000",
                "000000",
                "001111",
                "001111",
                "001111",
                "001111",
                "000000",
                "000000"
            ],
            ']': [
                "000000",
                "000000",
                "111100",
                "111100",
                "111100",
                "111100",
                "000000",
                "000000"
            ],
            '>': [
                "111111",
                "100111",
                "110011",
                "111100",
                "111100",
                "110011",
                "100111",
                "111111"
            ]
        };
    }

    generateEmojiArt() {
        const textInput = document.getElementById('textInput');
        const outputContainer = document.getElementById('emojiOutputContainer');
        const outputStats = document.getElementById('emojiOutputStats');
        
        if (!textInput || !outputContainer) return;

        let text = textInput.value;
        
        // Filter to supported characters only
        text = text.replace(/[^a-zA-Z0-9!?@#$%&*()_+\-=\[\]{};:'"\\|,.<>\/~`]/g, '');
        
        if (!text) {
            this.showError('Please enter valid text (A-Z, 0-9, and basic symbols)');
            return;
        }

        if (text.length > 20) {
            text = text.slice(0, 20);
            textInput.value = text;
        }

        // Check if all characters are supported
        for (let char of text) {
            if (!this.emojiPatterns[char]) {
                this.showError(`Character '${char}' is not supported`);
                return;
            }
        }

        // Get chosen style
        const style = this.getCurrentStyle();
        
        // Replace 0 and 1 with the chosen emojis
        const replacedPatterns = {};
        for (let key in this.emojiPatterns) {
            replacedPatterns[key] = this.emojiPatterns[key].map(line =>
                line.replace(/0/g, style.fill).replace(/1/g, style.empty)
            );
        }

        // Build emoji art vertically (stack characters)
        let emojiArt = '';
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const pattern = replacedPatterns[char];
            emojiArt += pattern.join('\n');
            
            // Add a separator between characters (except for the last one)
            if (i < text.length - 1) {
                emojiArt += '\n\n';
            }
        }

        // Display output
        outputContainer.innerHTML = `<pre class="generated-output emoji-art-text">${this.escapeHtml(emojiArt)}</pre>`;
        
        // Update stats
        const lines = emojiArt.split('\n').length;
        const chars = emojiArt.replace(/\n/g, '').length;
        if (outputStats) {
            outputStats.textContent = `${lines} lines, ${chars} characters`;
        }
        
        this.showSuccess('Emoji art generated successfully!');
    }

    copyToClipboard() {
        const output = document.querySelector('#emojiOutputContainer pre');
        const copyBtn = document.getElementById('copyEmojiBtn');
        
        if (!output || output.textContent.includes('Your emoji art will appear here')) {
            this.showError('No output to copy. Generate some emoji art first!');
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
                
                setTimeout(() => {
                    copyBtn.innerHTML = originalHTML;
                    copyBtn.style.background = '';
                    copyBtn.style.borderColor = '';
                }, 2000);
            }
        }).catch(() => {
            this.showError('Failed to copy. Please try again.');
        });
    }

    showSuccess(message) {
        const outputContainer = document.getElementById('emojiOutputContainer');
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
        `;
        
        outputContainer.style.position = 'relative';
        outputContainer.appendChild(msgDiv);
        
        setTimeout(() => msgDiv.remove(), 2000);
    }

    showError(message) {
        const outputContainer = document.getElementById('emojiOutputContainer');
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
        `;
        
        outputContainer.style.position = 'relative';
        outputContainer.appendChild(msgDiv);
        
        setTimeout(() => msgDiv.remove(), 3000);
    }

    clearOutput() {
        const outputContainer = document.getElementById('emojiOutputContainer');
        if (outputContainer) {
            outputContainer.innerHTML = `
                <div class="output-placeholder">
                    <span class="material-icons">emoji_emotions</span>
                    <p>Your emoji art will appear here</p>
                    <small>Select a style and click Generate</small>
                </div>
            `;
        }
        
        const outputStats = document.getElementById('emojiOutputStats');
        if (outputStats) {
            outputStats.textContent = '0 lines, 0 characters';
        }
        
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

// Initialize emoji art module globally
let emojiArtModule;

document.addEventListener('DOMContentLoaded', function() {
    emojiArtModule = new TextToEmojiModule();
    window.emojiArtModule = emojiArtModule;
});