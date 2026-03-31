const MAX_DURATION = 300;
const PIXELS_PER_SECOND_BASE = 50;
const TRACK_COLORS = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', 
    '#f97316', '#eab308', '#22c55e', '#14b8a6',
    '#06b6d4', '#3b82f6'
];

class AudioEngine {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.tracks = new Map();
        this.isPlaying = false;
        this.startTime = 0;
        this.pauseTime = 0;
        this.currentPosition = 0;
    }

    async init() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.connect(this.audioContext.destination);
    }

    async loadAudioFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
        return audioBuffer;
    }

    createTrackSource(trackId, audioBuffer, options = {}) {
        const source = this.audioContext.createBufferSource();
        const gainNode = this.audioContext.createGain();
        
        source.buffer = audioBuffer;
        source.playbackRate.value = options.playbackRate || 1;
        gainNode.gain.value = options.volume || 1;
        
        source.connect(gainNode);
        gainNode.connect(this.masterGain);
        
        return { source, gainNode };
    }

    playAll(tracksData, startPosition = 0) {
        if (this.isPlaying) return;
        
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }
        
        this.startTime = this.audioContext.currentTime - startPosition;
        this.isPlaying = true;
        
        tracksData.forEach(trackData => {
            if (trackData.muted) return;
            
            trackData.clips.forEach(clip => {
                if (clip.endTime <= startPosition) return;
                
                const { source, gainNode } = this.createTrackSource(
                    trackData.id, 
                    clip.audioBuffer,
                    { 
                        playbackRate: clip.playbackRate || 1,
                        volume: trackData.volume
                    }
                );
                
                const clipStart = Math.max(0, startPosition - clip.startTime);
                const actualStart = Math.max(0, clip.startTime - startPosition);
                const duration = clip.duration - clipStart;
                
                if (duration > 0) {
                    source.start(this.audioContext.currentTime + actualStart, clipStart, duration);
                    
                    if (!this.tracks.has(trackData.id)) {
                        this.tracks.set(trackData.id, []);
                    }
                    this.tracks.get(trackData.id).push({ source, gainNode, clip });
                }
            });
        });
    }

    stopAll() {
        this.tracks.forEach(sources => {
            sources.forEach(({ source }) => {
                try {
                    source.stop();
                } catch (e) {}
            });
        });
        this.tracks.clear();
        this.isPlaying = false;
        this.pauseTime = 0;
    }

    pauseAll(currentTime) {
        this.pauseTime = currentTime;
        this.stopAll();
        return this.pauseTime;
    }

    getCurrentTime() {
        if (!this.isPlaying) return this.pauseTime;
        return this.audioContext.currentTime - this.startTime;
    }

    setMasterVolume(value) {
        if (this.masterGain) {
            this.masterGain.gain.value = value;
        }
    }
}

class MusicStudio {
    constructor() {
        this.audioEngine = new AudioEngine();
        this.tracks = [];
        this.selectedClip = null;
        this.selectedTrack = null;
        this.isPlaying = false;
        this.currentPosition = 0;
        this.zoom = 1;
        this.bpm = 120;
        this.trackCounter = 0;
        this.clipboard = null;
        this.animationFrame = null;
        this.isDragging = false;
        this.dragType = null;
        this.dragStartX = 0;
        this.dragStartClipX = 0;
        this.dragStartClipWidth = 0;
        this.isPlayheadDragging = false;
        this.contextMenuPosition = 0;
        this.autoScrollInterval = null;
        this.metronomeEnabled = false;
        this.metronomeVolume = 0.5;
        this.currentBeat = 1;
        this.beatsPerMeasure = 4;
        this.lastBeatTime = 0;
        
        this.init();
    }

    async init() {
        await this.audioEngine.init();
        this.setupElements();
        this.setupEventListeners();
        this.drawRuler();
        this.updateTimelineWidth();
        this.addTrack();
    }

    setupElements() {
        this.playBtn = document.getElementById('playBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.currentTimeEl = document.getElementById('currentTime');
        this.totalTimeEl = document.getElementById('totalTime');
        this.zoomInBtn = document.getElementById('zoomInBtn');
        this.zoomOutBtn = document.getElementById('zoomOutBtn');
        this.zoomLevelEl = document.getElementById('zoomLevel');
        this.bpmInput = document.getElementById('bpmInput');
        this.addTrackBtn = document.getElementById('addTrackBtn');
        this.tracksList = document.getElementById('tracksList');
        this.timelineContent = document.getElementById('timelineContent');
        this.timelineScroll = document.getElementById('timelineScroll');
        this.playhead = document.getElementById('playhead');
        this.playheadHandle = document.getElementById('playheadHandle');
        this.rulerCanvas = document.getElementById('rulerCanvas');
        this.contextMenu = document.getElementById('contextMenu');
        this.trackContextMenu = document.getElementById('trackContextMenu');
        this.trackModal = document.getElementById('trackModal');
        this.modalBody = document.getElementById('modalBody');
        this.closeModal = document.getElementById('closeModal');
        this.audioFileInput = document.getElementById('audioFileInput');
        this.exportBtn = document.getElementById('exportBtn');
        this.sequencerBtn = document.getElementById('openSequencerBtn');
        this.sequencerPage = document.getElementById('sequencerPage');
        this.backToMainBtn = document.getElementById('backToMain');
        this.openRecordBtn = document.getElementById('openRecordBtn');
        this.recordPage = document.getElementById('recordPage');
        this.backFromRecord = document.getElementById('backFromRecord');
        this.recordCircleBtn = document.getElementById('recordCircleBtn');
        this.playRecordBtn = document.getElementById('playRecordBtn');
        this.stopRecordBtn = document.getElementById('stopRecordBtn');
        this.saveRecordingBtn = document.getElementById('saveRecordingBtn');
        this.recordWaveform = document.getElementById('recordWaveform');
        this.recordTimeEl = document.getElementById('recordTime');
        this.recordingsList = document.getElementById('recordingsList');
        this.recordingCountEl = document.getElementById('recordingCount');
    }

    setupEventListeners() {
        this.playBtn.addEventListener('click', () => this.togglePlay());
        this.stopBtn.addEventListener('click', () => this.stop());
        this.zoomInBtn.addEventListener('click', () => this.zoomIn());
        this.zoomOutBtn.addEventListener('click', () => this.zoomOut());
        this.bpmInput.addEventListener('change', (e) => {
            this.bpm = parseInt(e.target.value) || 120;
        });
        this.addTrackBtn.addEventListener('click', () => this.addTrack());
        this.closeModal.addEventListener('click', () => this.closeModalWindow());
        this.trackModal.addEventListener('click', (e) => {
            if (e.target === this.trackModal) this.closeModalWindow();
        });
        this.exportBtn.addEventListener('click', () => this.exportProject());
        
        if (this.sequencerBtn) {
            this.sequencerBtn.addEventListener('click', () => this.openSequencer());
        }
        
        if (this.backToMainBtn) {
            this.backToMainBtn.addEventListener('click', () => this.closeSequencer());
        }
        
        if (this.openRecordBtn) {
            this.openRecordBtn.addEventListener('click', () => this.openRecordPage());
        }
        
        if (this.backFromRecord) {
            this.backFromRecord.addEventListener('click', () => this.closeRecordPage());
        }
        
        if (this.recordCircleBtn) {
            this.recordCircleBtn.addEventListener('click', () => this.toggleRecording());
        }
        
        if (this.playRecordBtn) {
            this.playRecordBtn.addEventListener('click', () => this.playRecording());
        }
        
        if (this.stopRecordBtn) {
            this.stopRecordBtn.addEventListener('click', () => this.stopPlayback());
        }
        
        if (this.saveRecordingBtn) {
            this.saveRecordingBtn.addEventListener('click', () => this.saveRecording());
        }
        
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !e.target.matches('input, textarea')) {
                e.preventDefault();
                this.togglePlay();
            }
            if (e.code === 'Delete' && this.selectedClip) {
                this.deleteSelectedClip();
            }
            if (e.ctrlKey && e.code === 'KeyC' && this.selectedClip) {
                this.copyClip();
            }
            if (e.ctrlKey && e.code === 'KeyV' && this.clipboard) {
                this.pasteClip();
            }
        });

        this.timelineScroll.addEventListener('scroll', () => {
            this.syncScroll();
        });

        document.addEventListener('click', (e) => {
            if (!this.contextMenu.contains(e.target) && !this.trackContextMenu.contains(e.target)) {
                this.hideContextMenu();
                this.hideTrackContextMenu();
            }
        });

        this.contextMenu.querySelectorAll('li[data-action]').forEach(li => {
            li.addEventListener('click', () => {
                this.handleContextMenuAction(li.dataset.action);
            });
        });

        this.trackContextMenu.querySelectorAll('li[data-action]').forEach(li => {
            li.addEventListener('click', () => {
                this.handleTrackContextMenuAction(li.dataset.action);
            });
        });

        this.timelineContent.addEventListener('click', (e) => {
            if (e.target === this.timelineContent || e.target.classList.contains('track-timeline')) {
                this.deselectAll();
            }
        });

        this.timelineScroll.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('track-timeline') || e.target.classList.contains('empty-track')) {
                const rect = this.timelineScroll.getBoundingClientRect();
                const x = e.clientX - rect.left + this.timelineScroll.scrollLeft;
                this.currentPosition = x / this.getPixelsPerSecond();
                this.updatePlayhead();
            }
        });

        document.addEventListener('mousemove', (e) => this.handleDrag(e));
        document.addEventListener('mouseup', () => this.endDrag());
        
        this.playheadHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.startPlayheadDrag(e);
        });
        
        document.addEventListener('mousemove', (e) => {
            if (this.isPlayheadDragging) {
                this.handlePlayheadDrag(e);
            }
        });
        
        document.addEventListener('mouseup', () => {
            this.isPlayheadDragging = false;
            this.stopAutoScroll();
        });
    }

    getPixelsPerSecond() {
        return PIXELS_PER_SECOND_BASE * this.zoom;
    }

    addTrack() {
        this.trackCounter++;
        const trackId = `track-${this.trackCounter}`;
        const color = TRACK_COLORS[(this.trackCounter - 1) % TRACK_COLORS.length];
        
        const track = {
            id: trackId,
            name: `音轨 ${this.trackCounter}`,
            color: color,
            volume: 1,
            muted: false,
            solo: false,
            clips: []
        };
        
        this.tracks.push(track);
        this.renderTrack(track);
        this.updateTotalTime();
    }

    renderTrack(track) {
        const headerEl = document.createElement('div');
        headerEl.className = 'track-header';
        headerEl.dataset.trackId = track.id;
        headerEl.innerHTML = `
            <div class="track-header-top">
                <input type="text" class="track-name" value="${track.name}" data-track-id="${track.id}">
                <div class="track-actions">
                    <button class="track-action-btn mute-btn ${track.muted ? 'muted' : ''}" data-track-id="${track.id}" title="静音">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/>
                            ${track.muted ? 
                                '<line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>' :
                                '<path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>'
                            }
                        </svg>
                    </button>
                    <button class="track-action-btn solo-btn ${track.solo ? 'solo' : ''}" data-track-id="${track.id}" title="独奏">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                            <line x1="12" y1="19" x2="12" y2="23"/>
                            <line x1="8" y1="23" x2="16" y2="23"/>
                        </svg>
                    </button>
                    <button class="track-action-btn settings-btn" data-track-id="${track.id}" title="设置">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                    </button>
                    <button class="track-action-btn delete-btn" data-track-id="${track.id}" title="删除">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3,6 5,6 21,6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="track-controls">
                <div class="volume-control">
                    <svg class="volume-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/>
                        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    </svg>
                    <input type="range" class="volume-slider" min="0" max="100" value="${track.volume * 100}" data-track-id="${track.id}">
                    <span class="volume-value">${Math.round(track.volume * 100)}%</span>
                </div>
            </div>
        `;
        
        const timelineEl = document.createElement('div');
        timelineEl.className = 'track-timeline';
        timelineEl.dataset.trackId = track.id;
        
        const emptyTrack = document.createElement('div');
        emptyTrack.className = 'empty-track';
        emptyTrack.dataset.trackId = track.id;
        emptyTrack.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17,8 12,3 7,8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span style="margin-left: 8px;">点击上传音频</span>
        `;
        timelineEl.appendChild(emptyTrack);
        
        this.tracksList.appendChild(headerEl);
        this.timelineContent.appendChild(timelineEl);
        
        this.setupTrackEventListeners(headerEl, timelineEl, track);
    }

    setupTrackEventListeners(headerEl, timelineEl, track) {
        const nameInput = headerEl.querySelector('.track-name');
        nameInput.addEventListener('change', (e) => {
            track.name = e.target.value;
        });

        const muteBtn = headerEl.querySelector('.mute-btn');
        muteBtn.addEventListener('click', () => this.toggleMute(track));

        const soloBtn = headerEl.querySelector('.solo-btn');
        soloBtn.addEventListener('click', () => this.toggleSolo(track));

        const settingsBtn = headerEl.querySelector('.settings-btn');
        settingsBtn.addEventListener('click', () => this.showTrackSettings(track));

        const deleteBtn = headerEl.querySelector('.delete-btn');
        deleteBtn.addEventListener('click', () => this.deleteTrack(track));

        const volumeSlider = headerEl.querySelector('.volume-slider');
        const volumeValue = headerEl.querySelector('.volume-value');
        volumeSlider.addEventListener('input', (e) => {
            track.volume = e.target.value / 100;
            volumeValue.textContent = `${e.target.value}%`;
        });

        const emptyTrack = timelineEl.querySelector('.empty-track');
        emptyTrack.addEventListener('click', () => {
            this.selectedTrack = track;
            this.audioFileInput.click();
        });

        timelineEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            timelineEl.style.background = 'rgba(99, 102, 241, 0.1)';
        });

        timelineEl.addEventListener('dragleave', () => {
            timelineEl.style.background = '';
        });

        timelineEl.addEventListener('drop', (e) => {
            e.preventDefault();
            timelineEl.style.background = '';
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('audio/')) {
                this.loadAudioToTrack(file, track);
            }
        });

        timelineEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const rect = this.timelineScroll.getBoundingClientRect();
            const x = e.clientX - rect.left + this.timelineScroll.scrollLeft;
            this.contextMenuPosition = x / this.getPixelsPerSecond();
            this.selectedTrack = track;
            this.showTrackContextMenu(e.clientX, e.clientY);
        });
    }

    async loadAudioToTrack(file, track) {
        try {
            const audioBuffer = await this.audioEngine.loadAudioFile(file);
            const duration = audioBuffer.duration;
            
            const clip = {
                id: `clip-${Date.now()}`,
                audioBuffer: audioBuffer,
                fileName: file.name,
                startTime: 0,
                duration: duration,
                originalDuration: duration,
                playbackRate: 1,
                offset: 0,
                trimStart: 0,
                trimEnd: 0
            };
            
            track.clips.push(clip);
            this.renderClip(track, clip);
            this.updateTotalTime();
            this.updateEmptyTrackVisibility(track);
        } catch (error) {
            console.error('加载音频失败:', error);
            alert('加载音频失败，请确保文件格式正确');
        }
    }

    renderClip(track, clip) {
        const timelineEl = this.timelineContent.querySelector(`[data-track-id="${track.id}"]`);
        if (!timelineEl) return;

        const clipEl = document.createElement('div');
        clipEl.className = 'audio-clip';
        clipEl.dataset.clipId = clip.id;
        clipEl.dataset.trackId = track.id;
        
        const left = clip.startTime * this.getPixelsPerSecond();
        const width = clip.duration * this.getPixelsPerSecond();
        
        clipEl.style.left = `${left}px`;
        clipEl.style.width = `${width}px`;
        clipEl.style.background = `linear-gradient(135deg, ${track.color}, ${this.adjustColor(track.color, 30)})`;
        
        clipEl.innerHTML = `
            <div class="track-color-indicator" style="background: ${track.color}"></div>
            <div class="clip-handle left"></div>
            <div class="clip-waveform">
                <canvas></canvas>
            </div>
            <div class="clip-info">${clip.fileName}</div>
            <div class="clip-duration">${this.formatTime(clip.duration)}</div>
            ${clip.playbackRate !== 1 ? `<div class="speed-indicator">${clip.playbackRate.toFixed(2)}x</div>` : ''}
            <div class="clip-handle right"></div>
        `;
        
        timelineEl.appendChild(clipEl);
        
        this.drawWaveform(clipEl.querySelector('canvas'), clip.audioBuffer, clip);
        this.setupClipEventListeners(clipEl, track, clip);
    }

    drawWaveform(canvas, audioBuffer, clip) {
        const ctx = canvas.getContext('2d');
        const width = canvas.offsetWidth || 200;
        const height = canvas.offsetHeight || 60;
        
        canvas.width = width * window.devicePixelRatio;
        canvas.height = height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        const data = audioBuffer.getChannelData(0);
        const step = Math.ceil(data.length / width);
        const amp = height / 2;
        
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        
        ctx.beginPath();
        ctx.moveTo(0, amp);
        
        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;
            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            ctx.lineTo(i, (1 + min) * amp);
        }
        
        for (let i = width - 1; i >= 0; i--) {
            let min = 1.0;
            let max = -1.0;
            for (let j = 0; j < step; j++) {
                const datum = data[(i * step) + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }
            ctx.lineTo(i, (1 + max) * amp);
        }
        
        ctx.closePath();
        ctx.fill();
    }

    setupClipEventListeners(clipEl, track, clip) {
        clipEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectClip(clip, track, clipEl);
        });

        clipEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.selectClip(clip, track, clipEl);
            this.showContextMenu(e.clientX, e.clientY);
        });

        clipEl.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('clip-handle')) {
                this.startDrag(e, clip, track, clipEl, e.target.classList.contains('left') ? 'resize-left' : 'resize-right');
            } else {
                this.startDrag(e, clip, track, clipEl, 'move');
            }
        });

        clipEl.addEventListener('dblclick', () => {
            this.showClipSettings(track, clip);
        });
    }

    selectClip(clip, track, clipEl) {
        this.deselectAll();
        this.selectedClip = clip;
        this.selectedTrack = track;
        clipEl.classList.add('selected');
    }

    deselectAll() {
        document.querySelectorAll('.audio-clip.selected').forEach(el => {
            el.classList.remove('selected');
        });
        this.selectedClip = null;
        this.selectedTrack = null;
    }

    startDrag(e, clip, track, clipEl, type) {
        e.preventDefault();
        this.isDragging = true;
        this.dragType = type;
        this.dragClip = clip;
        this.dragTrack = track;
        this.dragClipEl = clipEl;
        this.dragStartX = e.clientX;
        this.dragStartClipX = parseFloat(clipEl.style.left);
        this.dragStartClipWidth = parseFloat(clipEl.style.width);
        this.dragStartClipStartTime = clip.startTime;
        this.dragStartClipDuration = clip.duration;
    }

    handleDrag(e) {
        if (!this.isDragging) return;
        
        this.handleAutoScroll(e);
        
        const deltaX = e.clientX - this.dragStartX;
        const pixelsPerSecond = this.getPixelsPerSecond();
        
        if (this.dragType === 'move') {
            let newLeft = this.dragStartClipX + deltaX;
            let newStartTime = newLeft / pixelsPerSecond;
            
            newStartTime = Math.max(0, newStartTime);
            newStartTime = Math.min(MAX_DURATION - this.dragClip.duration, newStartTime);
            
            this.dragClip.startTime = newStartTime;
            this.dragClipEl.style.left = `${newStartTime * pixelsPerSecond}px`;
        } else if (this.dragType === 'resize-left') {
            const newLeft = this.dragStartClipX + deltaX;
            const widthDelta = -deltaX;
            
            let newStartTime = newLeft / pixelsPerSecond;
            let newDuration = this.dragStartClipDuration + widthDelta / pixelsPerSecond;
            
            if (newStartTime >= 0 && newDuration >= 0.1) {
                const trimDelta = (newStartTime - this.dragStartClipStartTime);
                this.dragClip.trimStart = Math.max(0, this.dragClip.trimStart + trimDelta);
                this.dragClip.startTime = newStartTime;
                this.dragClip.duration = newDuration;
                
                this.dragClipEl.style.left = `${newLeft}px`;
                this.dragClipEl.style.width = `${newDuration * pixelsPerSecond}px`;
                this.updateClipDurationDisplay(this.dragClipEl, newDuration);
            }
        } else if (this.dragType === 'resize-right') {
            const newWidth = this.dragStartClipWidth + deltaX;
            let newDuration = newWidth / pixelsPerSecond;
            
            const maxDuration = this.dragClip.originalDuration - this.dragClip.trimStart;
            newDuration = Math.min(newDuration, maxDuration);
            newDuration = Math.max(0.1, newDuration);
            
            this.dragClip.duration = newDuration;
            this.dragClip.trimEnd = this.dragClip.originalDuration - this.dragClip.trimStart - newDuration;
            this.dragClipEl.style.width = `${newDuration * pixelsPerSecond}px`;
            this.updateClipDurationDisplay(this.dragClipEl, newDuration);
        }
        
        this.updateTotalTime();
    }

    handleAutoScroll(e) {
        const rect = this.timelineScroll.getBoundingClientRect();
        const scrollEdgeSize = 50;
        const scrollSpeed = 10;
        
        if (e.clientX < rect.left + scrollEdgeSize) {
            this.startAutoScroll(-scrollSpeed);
        } else if (e.clientX > rect.right - scrollEdgeSize) {
            this.startAutoScroll(scrollSpeed);
        } else {
            this.stopAutoScroll();
        }
    }

    startAutoScroll(speed) {
        if (this.autoScrollInterval) return;
        
        this.autoScrollInterval = setInterval(() => {
            const maxScroll = this.timelineScroll.scrollWidth - this.timelineScroll.clientWidth;
            const newScroll = this.timelineScroll.scrollLeft + speed;
            
            if (newScroll < 0 || newScroll > maxScroll) {
                this.stopAutoScroll();
                return;
            }
            
            this.timelineScroll.scrollLeft = newScroll;
            
            if (this.isDragging && this.dragType === 'move') {
                const pixelsPerSecond = this.getPixelsPerSecond();
                const scrollDelta = speed;
                this.dragStartClipX -= scrollDelta;
            }
        }, 16);
    }

    stopAutoScroll() {
        if (this.autoScrollInterval) {
            clearInterval(this.autoScrollInterval);
            this.autoScrollInterval = null;
        }
    }

    endDrag() {
        this.isDragging = false;
        this.dragType = null;
        this.stopAutoScroll();
    }

    startPlayheadDrag(e) {
        this.isPlayheadDragging = true;
        this.handlePlayheadDrag(e);
    }

    handlePlayheadDrag(e) {
        if (!this.isPlayheadDragging) return;
        
        this.handlePlayheadAutoScroll(e);
        
        const rect = this.timelineScroll.getBoundingClientRect();
        const x = e.clientX - rect.left + this.timelineScroll.scrollLeft;
        const newPosition = x / this.getPixelsPerSecond();
        
        this.currentPosition = Math.max(0, Math.min(newPosition, MAX_DURATION));
        this.updatePlayhead();
        this.updateCurrentTime();
    }

    handlePlayheadAutoScroll(e) {
        const rect = this.timelineScroll.getBoundingClientRect();
        const scrollEdgeSize = 50;
        const scrollSpeed = 10;
        
        if (e.clientX < rect.left + scrollEdgeSize) {
            this.startPlayheadAutoScroll(-scrollSpeed);
        } else if (e.clientX > rect.right - scrollEdgeSize) {
            this.startPlayheadAutoScroll(scrollSpeed);
        } else {
            this.stopAutoScroll();
        }
    }

    startPlayheadAutoScroll(speed) {
        if (this.autoScrollInterval) return;
        
        this.autoScrollInterval = setInterval(() => {
            const maxScroll = this.timelineScroll.scrollWidth - this.timelineScroll.clientWidth;
            const newScroll = this.timelineScroll.scrollLeft + speed;
            
            if (newScroll < 0 || newScroll > maxScroll) {
                this.stopAutoScroll();
                return;
            }
            
            this.timelineScroll.scrollLeft = newScroll;
            
            this.currentPosition += speed / this.getPixelsPerSecond();
            this.currentPosition = Math.max(0, Math.min(this.currentPosition, MAX_DURATION));
            this.updatePlayhead();
            this.updateCurrentTime();
        }, 16);
    }

    updateClipDurationDisplay(clipEl, duration) {
        const durationEl = clipEl.querySelector('.clip-duration');
        if (durationEl) {
            durationEl.textContent = this.formatTime(duration);
        }
    }

    showContextMenu(x, y) {
        this.contextMenu.style.left = `${x}px`;
        this.contextMenu.style.top = `${y}px`;
        this.contextMenu.classList.add('active');
    }

    hideContextMenu() {
        this.contextMenu.classList.remove('active');
    }

    showTrackContextMenu(x, y) {
        this.trackContextMenu.style.left = `${x}px`;
        this.trackContextMenu.style.top = `${y}px`;
        this.trackContextMenu.classList.add('active');
        
        const pasteItem = this.trackContextMenu.querySelector('[data-action="paste"]');
        if (pasteItem) {
            pasteItem.style.opacity = this.clipboard ? '1' : '0.5';
            pasteItem.style.pointerEvents = this.clipboard ? 'auto' : 'none';
        }
        
        const clipActions = this.trackContextMenu.querySelectorAll('.clip-action');
        clipActions.forEach(item => {
            item.style.opacity = this.selectedClip ? '1' : '0.5';
            item.style.pointerEvents = this.selectedClip ? 'auto' : 'none';
        });
    }

    hideTrackContextMenu() {
        this.trackContextMenu.classList.remove('active');
    }

    handleTrackContextMenuAction(action) {
        switch (action) {
            case 'import':
                if (this.selectedTrack) {
                    this.audioFileInput.click();
                }
                break;
            case 'paste':
                if (this.clipboard && this.selectedTrack) {
                    this.currentPosition = this.contextMenuPosition || this.currentPosition;
                    this.pasteClip();
                }
                break;
            case 'delete-all':
                if (this.selectedTrack) {
                    this.deleteAllClipsFromTrack(this.selectedTrack);
                }
                break;
            case 'cut':
                if (this.selectedClip) {
                    this.cutClip();
                }
                break;
            case 'copy':
                if (this.selectedClip) {
                    this.copyClip();
                }
                break;
            case 'delete':
                if (this.selectedClip) {
                    this.deleteSelectedClip();
                }
                break;
            case 'add-track':
                this.addTrack();
                break;
        }
        
        this.hideTrackContextMenu();
    }

    deleteAllClipsFromTrack(track) {
        const timelineEl = this.timelineContent.querySelector(`[data-track-id="${track.id}"]`);
        if (timelineEl) {
            const clipEls = timelineEl.querySelectorAll('.audio-clip');
            clipEls.forEach(el => el.remove());
        }
        
        track.clips = [];
        this.updateEmptyTrackVisibility(track);
        this.updateTotalTime();
    }

    handleContextMenuAction(action) {
        if (!this.selectedClip) return;
        
        switch (action) {
            case 'cut':
                this.cutClip();
                break;
            case 'copy':
                this.copyClip();
                break;
            case 'delete':
                this.deleteSelectedClip();
                break;
            case 'split':
                this.splitClip();
                break;
        }
        
        this.hideContextMenu();
    }

    copyClip() {
        if (!this.selectedClip) return;
        this.clipboard = {
            clip: {
                ...this.selectedClip,
                audioBuffer: this.selectedClip.audioBuffer
            },
            trackId: this.selectedTrack ? this.selectedTrack.id : null
        };
    }

    pasteClip() {
        if (!this.clipboard) return;
        
        const targetTrack = this.selectedTrack || this.tracks[0];
        if (!targetTrack) return;
        
        const newClip = {
            id: `clip-${Date.now()}`,
            audioBuffer: this.clipboard.clip.audioBuffer,
            fileName: this.clipboard.clip.fileName,
            startTime: this.currentPosition,
            duration: this.clipboard.clip.duration,
            originalDuration: this.clipboard.clip.originalDuration,
            playbackRate: this.clipboard.clip.playbackRate || 1,
            offset: this.clipboard.clip.offset || 0,
            trimStart: this.clipboard.clip.trimStart || 0,
            trimEnd: this.clipboard.clip.trimEnd || 0
        };
        
        targetTrack.clips.push(newClip);
        this.renderClip(targetTrack, newClip);
        this.updateTotalTime();
        this.updateEmptyTrackVisibility(targetTrack);
    }

    cutClip() {
        this.copyClip();
        this.deleteSelectedClip();
    }

    deleteSelectedClip() {
        if (!this.selectedClip || !this.selectedTrack) return;
        
        const clipEl = this.timelineContent.querySelector(`[data-clip-id="${this.selectedClip.id}"]`);
        if (clipEl) {
            clipEl.remove();
        }
        
        const clipIndex = this.selectedTrack.clips.findIndex(c => c.id === this.selectedClip.id);
        if (clipIndex > -1) {
            this.selectedTrack.clips.splice(clipIndex, 1);
        }
        
        this.updateEmptyTrackVisibility(this.selectedTrack);
        this.selectedClip = null;
        this.selectedTrack = null;
        this.updateTotalTime();
    }

    splitClip() {
        if (!this.selectedClip || !this.selectedTrack) return;
        
        const splitPoint = this.currentPosition - this.selectedClip.startTime;
        if (splitPoint <= 0 || splitPoint >= this.selectedClip.duration) return;
        
        const clip1 = {
            ...this.selectedClip,
            duration: splitPoint,
            trimEnd: this.selectedClip.originalDuration - this.selectedClip.trimStart - splitPoint
        };
        
        const clip2 = {
            ...this.selectedClip,
            id: `clip-${Date.now()}`,
            startTime: this.currentPosition,
            duration: this.selectedClip.duration - splitPoint,
            trimStart: this.selectedClip.trimStart + splitPoint
        };
        
        const clipIndex = this.selectedTrack.clips.findIndex(c => c.id === this.selectedClip.id);
        this.selectedTrack.clips.splice(clipIndex, 1, clip1, clip2);
        
        const clipEl = this.timelineContent.querySelector(`[data-clip-id="${this.selectedClip.id}"]`);
        if (clipEl) {
            clipEl.remove();
        }
        
        this.renderClip(this.selectedTrack, clip1);
        this.renderClip(this.selectedTrack, clip2);
        this.deselectAll();
    }

    toggleMute(track) {
        track.muted = !track.muted;
        const muteBtn = this.tracksList.querySelector(`[data-track-id="${track.id}"] .mute-btn`);
        if (muteBtn) {
            muteBtn.classList.toggle('muted', track.muted);
            muteBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/>
                    ${track.muted ? 
                        '<line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>' :
                        '<path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>'
                    }
                </svg>
            `;
        }
    }

    toggleSolo(track) {
        track.solo = !track.solo;
        const soloBtn = this.tracksList.querySelector(`[data-track-id="${track.id}"] .solo-btn`);
        if (soloBtn) {
            soloBtn.classList.toggle('solo', track.solo);
        }
    }

    showTrackSettings(track) {
        this.modalBody.innerHTML = `
            <div class="modal-section">
                <div class="modal-section-title">音轨名称</div>
                <input type="text" class="modal-input" id="modalTrackName" value="${track.name}">
            </div>
            <div class="modal-section">
                <div class="modal-section-title">音量</div>
                <div class="modal-slider-group">
                    <input type="range" class="modal-slider" id="modalVolume" min="0" max="100" value="${track.volume * 100}">
                    <span class="modal-slider-value" id="modalVolumeValue">${Math.round(track.volume * 100)}%</span>
                </div>
            </div>
            <div class="modal-section">
                <div class="modal-section-title">上传音频</div>
                <div class="upload-zone" id="uploadZone">
                    <div class="upload-zone-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17,8 12,3 7,8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                    </div>
                    <div class="upload-zone-text">点击或拖拽音频文件到此处</div>
                    <div class="upload-zone-hint">支持 MP3, WAV, OGG 等格式</div>
                </div>
            </div>
            <div class="modal-buttons">
                <button class="btn btn-secondary" id="modalCancel">取消</button>
                <button class="btn btn-primary" id="modalSave">保存</button>
            </div>
        `;
        
        const volumeSlider = document.getElementById('modalVolume');
        const volumeValue = document.getElementById('modalVolumeValue');
        volumeSlider.addEventListener('input', (e) => {
            volumeValue.textContent = `${e.target.value}%`;
        });
        
        const uploadZone = document.getElementById('uploadZone');
        uploadZone.addEventListener('click', () => {
            this.selectedTrack = track;
            this.audioFileInput.click();
        });
        
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.style.borderColor = 'var(--accent-primary)';
        });
        
        uploadZone.addEventListener('dragleave', () => {
            uploadZone.style.borderColor = '';
        });
        
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.style.borderColor = '';
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('audio/')) {
                this.loadAudioToTrack(file, track);
                this.closeModalWindow();
            }
        });
        
        document.getElementById('modalCancel').addEventListener('click', () => {
            this.closeModalWindow();
        });
        
        document.getElementById('modalSave').addEventListener('click', () => {
            track.name = document.getElementById('modalTrackName').value;
            track.volume = document.getElementById('modalVolume').value / 100;
            
            const nameInput = this.tracksList.querySelector(`[data-track-id="${track.id}"] .track-name`);
            if (nameInput) {
                nameInput.value = track.name;
            }
            
            const volumeSlider = this.tracksList.querySelector(`[data-track-id="${track.id}"] .volume-slider`);
            const volumeValue = this.tracksList.querySelector(`[data-track-id="${track.id}"] .volume-value`);
            if (volumeSlider && volumeValue) {
                volumeSlider.value = track.volume * 100;
                volumeValue.textContent = `${Math.round(track.volume * 100)}%`;
            }
            
            this.closeModalWindow();
        });
        
        this.trackModal.classList.add('active');
    }

    showClipSettings(track, clip) {
        this.modalBody.innerHTML = `
            <div class="modal-section">
                <div class="modal-section-title">片段信息</div>
                <div class="modal-input-group">
                    <label>文件名</label>
                    <input type="text" class="modal-input" value="${clip.fileName}" disabled>
                </div>
            </div>
            <div class="modal-section">
                <div class="modal-section-title">播放速度</div>
                <div class="modal-slider-group">
                    <input type="range" class="modal-slider" id="modalPlaybackRate" min="0.25" max="4" step="0.05" value="${clip.playbackRate}">
                    <span class="modal-slider-value" id="modalPlaybackRateValue">${clip.playbackRate.toFixed(2)}x</span>
                </div>
            </div>
            <div class="modal-section">
                <div class="modal-section-title">时间调整</div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="modal-input-group">
                        <label>开始时间 (秒)</label>
                        <input type="number" class="modal-input" id="modalStartTime" min="0" max="${MAX_DURATION}" step="0.1" value="${clip.startTime.toFixed(1)}">
                    </div>
                    <div class="modal-input-group">
                        <label>持续时间 (秒)</label>
                        <input type="number" class="modal-input" id="modalDuration" min="0.1" max="${clip.originalDuration}" step="0.1" value="${clip.duration.toFixed(1)}">
                    </div>
                </div>
            </div>
            <div class="modal-buttons">
                <button class="btn btn-secondary" id="modalCancel">取消</button>
                <button class="btn btn-primary" id="modalSave">保存</button>
            </div>
        `;
        
        const playbackRateSlider = document.getElementById('modalPlaybackRate');
        const playbackRateValue = document.getElementById('modalPlaybackRateValue');
        playbackRateSlider.addEventListener('input', (e) => {
            playbackRateValue.textContent = `${parseFloat(e.target.value).toFixed(2)}x`;
        });
        
        document.getElementById('modalCancel').addEventListener('click', () => {
            this.closeModalWindow();
        });
        
        document.getElementById('modalSave').addEventListener('click', () => {
            clip.playbackRate = parseFloat(document.getElementById('modalPlaybackRate').value);
            clip.startTime = parseFloat(document.getElementById('modalStartTime').value);
            clip.duration = parseFloat(document.getElementById('modalDuration').value);
            
            this.updateClipElement(track, clip);
            this.updateTotalTime();
            this.closeModalWindow();
        });
        
        this.trackModal.classList.add('active');
    }

    updateClipElement(track, clip) {
        const clipEl = this.timelineContent.querySelector(`[data-clip-id="${clip.id}"]`);
        if (!clipEl) return;
        
        const pixelsPerSecond = this.getPixelsPerSecond();
        clipEl.style.left = `${clip.startTime * pixelsPerSecond}px`;
        clipEl.style.width = `${clip.duration * pixelsPerSecond}px`;
        
        const durationEl = clipEl.querySelector('.clip-duration');
        if (durationEl) {
            durationEl.textContent = this.formatTime(clip.duration);
        }
        
        let speedIndicator = clipEl.querySelector('.speed-indicator');
        if (clip.playbackRate !== 1) {
            if (!speedIndicator) {
                speedIndicator = document.createElement('div');
                speedIndicator.className = 'speed-indicator';
                clipEl.appendChild(speedIndicator);
            }
            speedIndicator.textContent = `${clip.playbackRate.toFixed(2)}x`;
        } else if (speedIndicator) {
            speedIndicator.remove();
        }
    }

    closeModalWindow() {
        this.trackModal.classList.remove('active');
    }

    deleteTrack(track) {
        if (this.tracks.length <= 1) {
            alert('至少保留一个音轨');
            return;
        }
        
        const trackIndex = this.tracks.findIndex(t => t.id === track.id);
        if (trackIndex === -1) return;
        
        this.tracks.splice(trackIndex, 1);
        
        const headerEl = this.tracksList.querySelector(`[data-track-id="${track.id}"]`);
        const timelineEl = this.timelineContent.querySelector(`[data-track-id="${track.id}"]`);
        
        if (headerEl) headerEl.remove();
        if (timelineEl) timelineEl.remove();
        
        this.updateTotalTime();
    }

    updateEmptyTrackVisibility(track) {
        const timelineEl = this.timelineContent.querySelector(`[data-track-id="${track.id}"]`);
        if (!timelineEl) return;
        
        const emptyTrack = timelineEl.querySelector('.empty-track');
        if (emptyTrack) {
            emptyTrack.style.display = track.clips.length === 0 ? 'flex' : 'none';
        }
    }

    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    play() {
        if (this.isPlaying) return;
        
        this.isPlaying = true;
        this.playBtn.classList.add('playing');
        this.playBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16"/>
                <rect x="14" y="4" width="4" height="16"/>
            </svg>
        `;
        
        const tracksData = this.tracks.map(track => ({
            id: track.id,
            volume: track.volume,
            muted: track.muted || (this.tracks.some(t => t.solo) && !track.solo),
            clips: track.clips.map(clip => ({
                ...clip,
                startTime: clip.startTime,
                endTime: clip.startTime + clip.duration,
                duration: clip.duration / clip.playbackRate
            }))
        }));
        
        this.audioEngine.playAll(tracksData, this.currentPosition);
        this.startPlaybackLoop();
    }

    pause() {
        if (!this.isPlaying) return;
        
        this.currentPosition = this.audioEngine.pauseAll(this.audioEngine.getCurrentTime());
        this.isPlaying = false;
        this.playBtn.classList.remove('playing');
        this.playBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21"/>
            </svg>
        `;
        
        this.stopPlaybackLoop();
        this.updatePlayhead();
    }

    stop() {
        this.audioEngine.stopAll();
        this.isPlaying = false;
        this.currentPosition = 0;
        this.playBtn.classList.remove('playing');
        this.playBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21"/>
            </svg>
        `;
        
        this.stopPlaybackLoop();
        this.updatePlayhead();
        this.updateCurrentTime();
    }

    startPlaybackLoop() {
        const loop = () => {
            if (!this.isPlaying) return;
            
            this.currentPosition = this.audioEngine.getCurrentTime();
            this.updatePlayhead();
            this.updateCurrentTime();
            
            const maxDuration = this.getMaxDuration();
            if (this.currentPosition >= maxDuration) {
                this.stop();
                return;
            }
            
            this.animationFrame = requestAnimationFrame(loop);
        };
        
        this.animationFrame = requestAnimationFrame(loop);
    }

    stopPlaybackLoop() {
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
    }

    updatePlayhead() {
        const pixelsPerSecond = this.getPixelsPerSecond();
        const left = 200 + (this.currentPosition * pixelsPerSecond) - this.timelineScroll.scrollLeft;
        this.playhead.style.left = `${200 + this.currentPosition * pixelsPerSecond}px`;
    }

    updateCurrentTime() {
        this.currentTimeEl.textContent = this.formatTime(this.currentPosition);
    }

    updateTotalTime() {
        const maxDuration = this.getMaxDuration();
        this.totalTimeEl.textContent = this.formatTime(Math.max(maxDuration, MAX_DURATION));
    }

    getMaxDuration() {
        let maxDuration = 0;
        this.tracks.forEach(track => {
            track.clips.forEach(clip => {
                const endTime = clip.startTime + clip.duration;
                if (endTime > maxDuration) {
                    maxDuration = endTime;
                }
            });
        });
        return Math.min(maxDuration, MAX_DURATION);
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }

    zoomIn() {
        this.zoom = Math.min(this.zoom * 1.5, 8);
        this.updateZoom();
    }

    zoomOut() {
        this.zoom = Math.max(this.zoom / 1.5, 0.25);
        this.updateZoom();
    }

    updateZoom() {
        this.zoomLevelEl.textContent = `${Math.round(this.zoom * 100)}%`;
        this.updateTimelineWidth();
        this.drawRuler();
        this.rerenderAllClips();
        this.updatePlayhead();
    }

    updateTimelineWidth() {
        const width = MAX_DURATION * this.getPixelsPerSecond();
        this.timelineContent.style.width = `${width}px`;
        
        const rulerCanvas = this.rulerCanvas;
        rulerCanvas.width = width * window.devicePixelRatio;
        rulerCanvas.height = 30 * window.devicePixelRatio;
        rulerCanvas.style.width = `${width}px`;
    }

    drawRuler() {
        const ctx = this.rulerCanvas.getContext('2d');
        const width = this.rulerCanvas.width / window.devicePixelRatio;
        const height = 30;
        
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        
        ctx.strokeStyle = '#333';
        ctx.fillStyle = '#666';
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        
        const pixelsPerSecond = this.getPixelsPerSecond();
        const step = this.getRulerStep();
        
        for (let i = 0; i <= MAX_DURATION; i += step) {
            const x = i * pixelsPerSecond;
            
            ctx.beginPath();
            ctx.moveTo(x, i % 5 === 0 ? height - 15 : height - 8);
            ctx.lineTo(x, height);
            ctx.stroke();
            
            if (i % 5 === 0 || step >= 1) {
                const mins = Math.floor(i / 60);
                const secs = Math.floor(i % 60);
                ctx.fillText(`${mins}:${secs.toString().padStart(2, '0')}`, x, height - 18);
            }
        }
    }

    getRulerStep() {
        const pixelsPerSecond = this.getPixelsPerSecond();
        if (pixelsPerSecond >= 100) return 1;
        if (pixelsPerSecond >= 50) return 2;
        if (pixelsPerSecond >= 25) return 5;
        if (pixelsPerSecond >= 10) return 10;
        return 30;
    }

    rerenderAllClips() {
        this.tracks.forEach(track => {
            track.clips.forEach(clip => {
                const clipEl = this.timelineContent.querySelector(`[data-clip-id="${clip.id}"]`);
                if (clipEl) {
                    const pixelsPerSecond = this.getPixelsPerSecond();
                    clipEl.style.left = `${clip.startTime * pixelsPerSecond}px`;
                    clipEl.style.width = `${clip.duration * pixelsPerSecond}px`;
                    
                    const canvas = clipEl.querySelector('canvas');
                    if (canvas) {
                        this.drawWaveform(canvas, clip.audioBuffer, clip);
                    }
                }
            });
        });
    }

    syncScroll() {
        const rulerContainer = document.getElementById('timelineRuler');
        rulerContainer.scrollLeft = this.timelineScroll.scrollLeft;
        this.updatePlayhead();
    }

    adjustColor(color, amount) {
        const hex = color.replace('#', '');
        const r = Math.min(255, parseInt(hex.substr(0, 2), 16) + amount);
        const g = Math.min(255, parseInt(hex.substr(2, 2), 16) + amount);
        const b = Math.min(255, parseInt(hex.substr(4, 2), 16) + amount);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    async exportProject() {
        const maxDuration = this.getMaxDuration();
        if (maxDuration === 0) {
            alert('没有可导出的音频内容');
            return;
        }
        
        const offlineContext = new OfflineAudioContext(
            2,
            maxDuration * 44100,
            44100
        );
        
        this.tracks.forEach(track => {
            if (track.muted) return;
            if (this.tracks.some(t => t.solo) && !track.solo) return;
            
            track.clips.forEach(clip => {
                const source = offlineContext.createBufferSource();
                const gainNode = offlineContext.createGain();
                
                source.buffer = clip.audioBuffer;
                source.playbackRate.value = clip.playbackRate;
                gainNode.gain.value = track.volume;
                
                source.connect(gainNode);
                gainNode.connect(offlineContext.destination);
                
                source.start(clip.startTime, clip.trimStart, clip.duration / clip.playbackRate);
            });
        });
        
        try {
            const renderedBuffer = await offlineContext.startRendering();
            const wav = this.bufferToWav(renderedBuffer);
            const blob = new Blob([wav], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = `${document.getElementById('projectName').value || 'export'}.wav`;
            a.click();
            
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('导出失败:', error);
            alert('导出失败，请重试');
        }
    }

    bufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1;
        const bitDepth = 16;
        
        let result;
        if (numChannels === 2) {
            result = this.interleave(buffer.getChannelData(0), buffer.getChannelData(1));
        } else {
            result = buffer.getChannelData(0);
        }
        
        const dataLength = result.length * (bitDepth / 8);
        const bufferLength = 44 + dataLength;
        const arrayBuffer = new ArrayBuffer(bufferLength);
        const view = new DataView(arrayBuffer);
        
        this.writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        this.writeString(view, 8, 'WAVE');
        this.writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
        view.setUint16(32, numChannels * (bitDepth / 8), true);
        view.setUint16(34, bitDepth, true);
        this.writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true);
        
        this.floatTo16BitPCM(view, 44, result);
        
        return arrayBuffer;
    }

    writeString(view, offset, string) {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    }

    interleave(leftChannel, rightChannel) {
        const length = leftChannel.length + rightChannel.length;
        const result = new Float32Array(length);
        
        let inputIndex = 0;
        for (let i = 0; i < length;) {
            result[i++] = leftChannel[inputIndex];
            result[i++] = rightChannel[inputIndex];
            inputIndex++;
        }
        
        return result;
    }

    floatTo16BitPCM(view, offset, input) {
        for (let i = 0; i < input.length; i++, offset += 2) {
            const s = Math.max(-1, Math.min(1, input[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
    }

    openSequencer() {
        if (this.sequencerPage) {
            this.sequencerPage.classList.add('active');
            this.initSequencer();
        }
    }

    closeSequencer() {
        if (this.sequencerPage) {
            this.sequencerPage.classList.remove('active');
            this.stopSequencer();
        }
    }

    initSequencer() {
        if (!this.sequencerInitialized) {
            this.sequencerInitialized = true;
            this.seqBpm = 120;
            this.seqStepCount = 16;
            this.seqCurrentStep = 0;
            this.seqIsPlaying = false;
            this.seqInterval = null;
            this.customSoundCounter = 0;
            
            this.sounds = [
                { name: 'Kick', color: '#ef4444', type: 'kick', isCustom: false },
                { name: 'Snare', color: '#f97316', type: 'snare', isCustom: false },
                { name: 'Hi-Hat', color: '#eab308', type: 'hihat', isCustom: false },
                { name: 'Clap', color: '#22c55e', type: 'clap', isCustom: false },
                { name: 'Tom', color: '#06b6d4', type: 'tom', isCustom: false },
                { name: 'Rim', color: '#8b5cf6', type: 'rim', isCustom: false }
            ];
            
            this.seqPattern = this.sounds.map(() => new Array(32).fill(false));
            
            this.setupSequencerUI();
        }
    }

    setupSequencerUI() {
        const soundLabels = document.getElementById('soundLabels');
        const sequencerGrid = document.getElementById('sequencerGrid');
        const stepIndicators = document.getElementById('stepIndicators');
        
        if (!soundLabels || !sequencerGrid || !stepIndicators) return;
        
        soundLabels.innerHTML = '';
        sequencerGrid.innerHTML = '';
        stepIndicators.innerHTML = '';
        
        this.sounds.forEach((sound, rowIndex) => {
            const labelEl = document.createElement('div');
            labelEl.className = 'sound-label';
            
            const volume = sound.volume !== undefined ? sound.volume : 1;
            
            labelEl.innerHTML = `
                <div class="sound-label-top">
                    <span class="sound-color" style="background: ${sound.color}"></span>
                    <input type="text" class="sound-name-input" value="${sound.name}" data-row="${rowIndex}" maxlength="12">
                    ${sound.isCustom ? '<span class="custom-sound-indicator" title="自定义音效"></span>' : ''}
                    ${sound.isCustom ? `<button class="delete-sound-btn" data-row="${rowIndex}" title="删除">×</button>` : ''}
                </div>
                <div class="sound-volume-control">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/>
                    </svg>
                    <input type="range" class="sound-volume-slider" min="0" max="100" value="${volume * 100}" data-row="${rowIndex}">
                    <span class="sound-volume-value">${Math.round(volume * 100)}%</span>
                </div>
            `;
            
            const nameInput = labelEl.querySelector('.sound-name-input');
            nameInput.addEventListener('change', (e) => {
                this.sounds[rowIndex].name = e.target.value.substring(0, 12);
            });
            nameInput.addEventListener('click', (e) => e.stopPropagation());
            
            const volumeSlider = labelEl.querySelector('.sound-volume-slider');
            const volumeValue = labelEl.querySelector('.sound-volume-value');
            volumeSlider.addEventListener('input', (e) => {
                const vol = e.target.value / 100;
                this.sounds[rowIndex].volume = vol;
                volumeValue.textContent = `${e.target.value}%`;
            });
            volumeSlider.addEventListener('click', (e) => e.stopPropagation());
            
            labelEl.addEventListener('click', (e) => {
                if (!e.target.classList.contains('delete-sound-btn') && 
                    !e.target.classList.contains('sound-name-input') &&
                    !e.target.classList.contains('sound-volume-slider')) {
                    this.playSound(sound.type, sound.audioBuffer, volume);
                }
            });
            
            const deleteBtn = labelEl.querySelector('.delete-sound-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteSoundRow(rowIndex);
                });
            }
            
            soundLabels.appendChild(labelEl);
            
            const rowEl = document.createElement('div');
            rowEl.className = 'sequencer-row';
            
            for (let step = 0; step < this.seqStepCount; step++) {
                const cellEl = document.createElement('div');
                cellEl.className = 'sequencer-cell';
                cellEl.dataset.row = rowIndex;
                cellEl.dataset.step = step;
                
                const cellWidth = Math.max(40, 800 / this.seqStepCount);
                cellEl.style.width = `${cellWidth}px`;
                cellEl.style.background = this.seqPattern[rowIndex] && this.seqPattern[rowIndex][step] ? sound.color : '';
                
                if (step % 4 === 0) {
                    cellEl.classList.add('downbeat');
                }
                
                cellEl.addEventListener('click', () => {
                    if (!this.seqPattern[rowIndex]) {
                        this.seqPattern[rowIndex] = new Array(32).fill(false);
                    }
                    this.seqPattern[rowIndex][step] = !this.seqPattern[rowIndex][step];
                    cellEl.style.background = this.seqPattern[rowIndex][step] ? sound.color : '';
                    this.playSound(sound.type, sound.audioBuffer, volume);
                });
                
                rowEl.appendChild(cellEl);
            }
            
            sequencerGrid.appendChild(rowEl);
        });
        
        for (let step = 0; step < this.seqStepCount; step++) {
            const indicatorEl = document.createElement('div');
            indicatorEl.className = 'step-indicator';
            const cellWidth = Math.max(40, 800 / this.seqStepCount);
            indicatorEl.style.width = `${cellWidth}px`;
            indicatorEl.textContent = step + 1;
            
            if (step % 4 === 0) {
                indicatorEl.classList.add('downbeat');
            }
            
            stepIndicators.appendChild(indicatorEl);
        }
        
        const seqPlayBtn = document.getElementById('seqPlayBtn');
        const seqStopBtn = document.getElementById('seqStopBtn');
        const seqClearBtn = document.getElementById('seqClearBtn');
        const seqExportBtn = document.getElementById('seqExportBtn');
        const seqBpmInput = document.getElementById('seqBpm');
        const stepCountSelect = document.getElementById('stepCount');
        const seqImportSoundBtn = document.getElementById('seqImportSoundBtn');
        const addSoundBtn = document.getElementById('addSoundBtn');
        
        if (seqPlayBtn) seqPlayBtn.addEventListener('click', () => this.toggleSequencerPlay());
        if (seqStopBtn) seqStopBtn.addEventListener('click', () => this.stopSequencer());
        if (seqClearBtn) seqClearBtn.addEventListener('click', () => this.clearSequencer());
        if (seqExportBtn) seqExportBtn.addEventListener('click', () => this.exportSequencer());
        if (seqImportSoundBtn) seqImportSoundBtn.addEventListener('click', () => this.importCustomSound());
        if (addSoundBtn) addSoundBtn.addEventListener('click', () => this.importCustomSound());
        
        if (seqBpmInput) {
            seqBpmInput.addEventListener('change', (e) => {
                this.seqBpm = parseInt(e.target.value) || 120;
                if (this.seqIsPlaying) {
                    this.stopSequencer();
                    this.playSequencer();
                }
            });
        }
        if (stepCountSelect) {
            stepCountSelect.addEventListener('change', (e) => {
                this.seqStepCount = parseInt(e.target.value);
                this.seqPattern = this.sounds.map(() => new Array(32).fill(false));
                this.setupSequencerUI();
            });
        }
    }

    async importCustomSound() {
        const input = document.getElementById('seqSoundFileInput');
        if (input) {
            input.click();
        }
    }

    async loadCustomSound(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await this.audioEngine.audioContext.decodeAudioData(arrayBuffer);
            
            this.customSoundCounter++;
            const customColors = ['#ec4899', '#f43f5e', '#84cc16', '#14b8a6', '#6366f1', '#a855f7'];
            const colorIndex = (this.sounds.length) % customColors.length;
            
            const newSound = {
                name: file.name.replace(/\.[^/.]+$/, '').substring(0, 12),
                color: customColors[colorIndex],
                type: `custom-${this.customSoundCounter}`,
                isCustom: true,
                audioBuffer: audioBuffer
            };
            
            this.sounds.push(newSound);
            this.seqPattern.push(new Array(32).fill(false));
            this.setupSequencerUI();
            
            this.playSound(newSound.type, audioBuffer);
        } catch (error) {
            console.error('加载音效失败:', error);
            alert('加载音效失败，请确保文件格式正确');
        }
    }

    deleteSoundRow(rowIndex) {
        if (rowIndex < 6) {
            alert('内置音效不能删除');
            return;
        }
        
        this.sounds.splice(rowIndex, 1);
        this.seqPattern.splice(rowIndex, 1);
        this.setupSequencerUI();
    }

    toggleSequencerPlay() {
        if (this.seqIsPlaying) {
            this.stopSequencer();
        } else {
            this.playSequencer();
        }
    }

    playSequencer() {
        this.seqIsPlaying = true;
        const seqPlayBtn = document.getElementById('seqPlayBtn');
        if (seqPlayBtn) {
            seqPlayBtn.classList.add('playing');
            seqPlayBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
            `;
        }
        
        const stepDuration = (60 / this.seqBpm) * 1000 / 4;
        
        this.seqInterval = setInterval(() => {
            this.playStep();
            this.seqCurrentStep = (this.seqCurrentStep + 1) % this.seqStepCount;
        }, stepDuration);
    }

    stopSequencer() {
        this.seqIsPlaying = false;
        this.seqCurrentStep = 0;
        
        if (this.seqInterval) {
            clearInterval(this.seqInterval);
            this.seqInterval = null;
        }
        
        const seqPlayBtn = document.getElementById('seqPlayBtn');
        if (seqPlayBtn) {
            seqPlayBtn.classList.remove('playing');
            seqPlayBtn.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21"/>
                </svg>
            `;
        }
        
        this.updateStepIndicator(0);
    }

    playStep() {
        this.updateStepIndicator(this.seqCurrentStep);
        
        this.sounds.forEach((sound, rowIndex) => {
            if (this.seqPattern[rowIndex] && this.seqPattern[rowIndex][this.seqCurrentStep]) {
                const volume = sound.volume !== undefined ? sound.volume : 1;
                this.playSound(sound.type, sound.audioBuffer, volume);
            }
        });
    }

    updateStepIndicator(step) {
        const cells = document.querySelectorAll('.sequencer-cell');
        cells.forEach(cell => {
            cell.classList.remove('current');
            if (parseInt(cell.dataset.step) === step) {
                cell.classList.add('current');
            }
        });
        
        const indicators = document.querySelectorAll('.step-indicator');
        indicators.forEach((indicator, index) => {
            indicator.classList.remove('active');
            if (index === step) {
                indicator.classList.add('active');
            }
        });
    }

    playSound(type, customAudioBuffer = null, volume = 1) {
        if (customAudioBuffer) {
            this.playCustomSound(customAudioBuffer, volume);
            return;
        }
        
        const audioContext = this.audioEngine.audioContext;
        if (!audioContext) return;
        
        switch (type) {
            case 'kick':
                this.playKick(audioContext, volume);
                break;
            case 'snare':
                this.playSnare(audioContext, volume);
                break;
            case 'hihat':
                this.playHiHat(audioContext, volume);
                break;
            case 'clap':
                this.playClap(audioContext, volume);
                break;
            case 'tom':
                this.playTom(audioContext, volume);
                break;
            case 'rim':
                this.playRim(audioContext, volume);
                break;
        }
    }

    playCustomSound(audioBuffer, volume = 1) {
        const audioContext = this.audioEngine.audioContext;
        if (!audioContext || !audioBuffer) return;
        
        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();
        
        const stepDuration = (60 / this.seqBpm) / 4;
        const sampleRate = audioBuffer.sampleRate;
        const samplesNeeded = Math.floor(stepDuration * sampleRate);
        const channels = audioBuffer.numberOfChannels;
        
        const newBuffer = audioContext.createBuffer(channels, samplesNeeded, sampleRate);
        
        for (let channel = 0; channel < channels; channel++) {
            const sourceData = audioBuffer.getChannelData(channel);
            const destData = newBuffer.getChannelData(channel);
            const copyLength = Math.min(sourceData.length, samplesNeeded);
            for (let i = 0; i < copyLength; i++) {
                destData[i] = sourceData[i];
            }
        }
        
        source.buffer = newBuffer;
        gainNode.gain.value = volume;
        
        source.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        source.start(0);
    }

    playKick(ctx, volume = 1) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
    }

    playSnare(ctx, volume = 1) {
        const noise = ctx.createBufferSource();
        const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < output.length; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        noise.buffer = noiseBuffer;
        
        const noiseFilter = ctx.createBiquadFilter();
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.value = 1000;
        
        const noiseGain = ctx.createGain();
        noiseGain.gain.setValueAtTime(volume, ctx.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(ctx.destination);
        
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, ctx.currentTime);
        oscGain.gain.setValueAtTime(0.7 * volume, ctx.currentTime);
        oscGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        
        osc.connect(oscGain);
        oscGain.connect(ctx.destination);
        
        noise.start(ctx.currentTime);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
    }

    playHiHat(ctx, volume = 1) {
        const fundamental = 40;
        const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
        
        const bandpass = ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 10000;
        
        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 7000;
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.3 * volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
        
        ratios.forEach(ratio => {
            const osc = ctx.createOscillator();
            osc.type = 'square';
            osc.frequency.value = fundamental * ratio;
            osc.connect(bandpass);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.05);
        });
        
        bandpass.connect(highpass);
        highpass.connect(gain);
        gain.connect(ctx.destination);
    }

    playClap(ctx, volume = 1) {
        const noise = ctx.createBufferSource();
        const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < output.length; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        noise.buffer = noiseBuffer;
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1200;
        filter.Q.value = 1;
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.setValueAtTime(volume, ctx.currentTime + 0.01);
        gain.gain.setValueAtTime(0.3 * volume, ctx.currentTime + 0.02);
        gain.gain.setValueAtTime(volume, ctx.currentTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        
        noise.start(ctx.currentTime);
    }

    playTom(ctx, volume = 1) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.2);
        
        gain.gain.setValueAtTime(volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);
    }

    playRim(ctx, volume = 1) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'triangle';
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        
        gain.gain.setValueAtTime(0.5 * volume, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.02);
        
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.02);
    }

    clearSequencer() {
        this.seqPattern = this.sounds.map(() => new Array(32).fill(false));
        this.setupSequencerUI();
    }

    async exportSequencer() {
        const offlineCtx = new OfflineAudioContext(2, 44100 * (this.seqStepCount / 4) * (60 / this.seqBpm), 44100);
        const stepDuration = (60 / this.seqBpm) / 4;
        
        this.sounds.forEach((sound, rowIndex) => {
            for (let step = 0; step < this.seqStepCount; step++) {
                if (this.seqPattern[rowIndex] && this.seqPattern[rowIndex][step]) {
                    const startTime = step * stepDuration;
                    this.renderSound(offlineCtx, sound.type, startTime, sound.audioBuffer);
                }
            }
        });
        
        try {
            const renderedBuffer = await offlineCtx.startRendering();
            const wav = this.bufferToWav(renderedBuffer);
            const blob = new Blob([wav], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = 'sequencer-beat.wav';
            a.click();
            
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('导出失败:', error);
            alert('导出失败，请重试');
        }
    }

    renderSound(ctx, type, startTime, customAudioBuffer = null, volume = 1) {
        if (customAudioBuffer) {
            this.renderCustomSound(ctx, startTime, customAudioBuffer, volume);
            return;
        }
        
        switch (type) {
            case 'kick':
                this.renderKick(ctx, startTime, volume);
                break;
            case 'snare':
                this.renderSnare(ctx, startTime, volume);
                break;
            case 'hihat':
                this.renderHiHat(ctx, startTime, volume);
                break;
            case 'clap':
                this.renderClap(ctx, startTime, volume);
                break;
            case 'tom':
                this.renderTom(ctx, startTime, volume);
                break;
            case 'rim':
                this.renderRim(ctx, startTime, volume);
                break;
        }
    }

    renderCustomSound(ctx, startTime, audioBuffer, volume = 1) {
        const source = ctx.createBufferSource();
        const gainNode = ctx.createGain();
        
        const stepDuration = (60 / this.seqBpm) / 4;
        const sampleRate = audioBuffer.sampleRate;
        const samplesNeeded = Math.floor(stepDuration * sampleRate);
        const channels = audioBuffer.numberOfChannels;
        
        const newBuffer = ctx.createBuffer(channels, samplesNeeded, sampleRate);
        
        for (let channel = 0; channel < channels; channel++) {
            const sourceData = audioBuffer.getChannelData(channel);
            const destData = newBuffer.getChannelData(channel);
            const copyLength = Math.min(sourceData.length, samplesNeeded);
            for (let i = 0; i < copyLength; i++) {
                destData[i] = sourceData[i];
            }
        }
        
        source.buffer = newBuffer;
        gainNode.gain.value = volume;
        
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        source.start(startTime);
    }

    renderKick(ctx, startTime, volume = 1) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(150, startTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, startTime + 0.5);
        gain.gain.setValueAtTime(1, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.5);
        osc.start(startTime);
        osc.stop(startTime + 0.5);
    }

    renderSnare(ctx, startTime) {
        const noise = ctx.createBufferSource();
        const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < output.length; i++) output[i] = Math.random() * 2 - 1;
        noise.buffer = noiseBuffer;
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 1000;
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(1, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.2);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noise.start(startTime);
        
        const osc = ctx.createOscillator();
        const oscGain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(180, startTime);
        oscGain.gain.setValueAtTime(0.7, startTime);
        oscGain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);
        osc.connect(oscGain);
        oscGain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.1);
    }

    renderHiHat(ctx, startTime) {
        const fundamental = 40;
        const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
        
        const bandpass = ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 10000;
        
        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 7000;
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.3, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.05);
        
        bandpass.connect(highpass);
        highpass.connect(gain);
        gain.connect(ctx.destination);
        
        ratios.forEach(ratio => {
            const osc = ctx.createOscillator();
            osc.type = 'square';
            osc.frequency.value = fundamental * ratio;
            osc.connect(bandpass);
            osc.start(startTime);
            osc.stop(startTime + 0.05);
        });
    }

    renderClap(ctx, startTime) {
        const noise = ctx.createBufferSource();
        const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < output.length; i++) output[i] = Math.random() * 2 - 1;
        noise.buffer = noiseBuffer;
        
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1200;
        filter.Q.value = 1;
        
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.setValueAtTime(1, startTime + 0.01);
        gain.gain.setValueAtTime(0.3, startTime + 0.02);
        gain.gain.setValueAtTime(1, startTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.3);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        noise.start(startTime);
    }

    renderTom(ctx, startTime) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(200, startTime);
        osc.frequency.exponentialRampToValueAtTime(50, startTime + 0.2);
        gain.gain.setValueAtTime(1, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.2);
        osc.start(startTime);
        osc.stop(startTime + 0.2);
    }

    renderRim(ctx, startTime) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(800, startTime);
        gain.gain.setValueAtTime(0.5, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.02);
        osc.start(startTime);
        osc.stop(startTime + 0.02);
    }

    openRecordPage() {
        if (this.recordPage) {
            this.recordPage.classList.add('active');
            this.initRecording();
        }
    }

    closeRecordPage() {
        if (this.recordPage) {
            this.recordPage.classList.remove('active');
            this.stopRecording();
            this.stopPlayback();
        }
    }

    initRecording() {
        if (!this.recordingInitialized) {
            this.recordingInitialized = true;
            this.recordings = [];
            this.isRecording = false;
            this.isPlayingRecording = false;
            this.currentRecording = null;
            this.recordStartTime = 0;
            this.recordedChunks = [];
            this.mediaStream = null;
            this.updateRecordingsList();
        }
        this.setupWaveformCanvas();
    }

    setupWaveformCanvas() {
        if (!this.recordWaveform) return;
        
        const canvas = this.recordWaveform;
        const container = canvas.parentElement;
        canvas.width = container.offsetWidth * window.devicePixelRatio;
        canvas.height = container.offsetHeight * window.devicePixelRatio;
        
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        this.waveformCtx = ctx;
        this.waveformWidth = canvas.width;
        this.waveformHeight = canvas.height;
        this.waveformCenter = this.waveformHeight / 2;
    }

    async toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            await this.startRecording();
        }
    }

    async startRecording() {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.audioRecordContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioRecordContext.createMediaStreamSource(this.mediaStream);
            this.analyser = this.audioRecordContext.createAnalyser();
            this.analyser.fftSize = 2048;
            source.connect(this.analyser);
            
            this.mediaRecorder = new MediaRecorder(this.mediaStream);
            this.recordedChunks = [];
            
            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    this.recordedChunks.push(e.data);
                }
            };
            
            this.mediaRecorder.onstop = async () => {
                const blob = new Blob(this.recordedChunks, { type: 'audio/webm' });
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await this.audioRecordContext.decodeAudioData(arrayBuffer);
                
                this.currentRecording = {
                    id: `recording-${Date.now()}`,
                    name: `录音 ${this.recordings.length + 1}`,
                    audioBuffer: audioBuffer,
                    duration: audioBuffer.duration,
                    createdAt: new Date()
                };
                
                this.recordings.push(this.currentRecording);
                this.updateRecordingsList();
                this.updateRecordingCount();
                
                this.playRecordBtn.disabled = false;
                this.saveRecordingBtn.disabled = false;
            };
            
            this.mediaRecorder.start();
            this.isRecording = true;
            this.recordStartTime = Date.now();
            
            this.recordCircleBtn.classList.add('recording');
            this.stopRecordBtn.disabled = false;
            
            this.drawWaveform();
            this.updateRecordTime();
            
        } catch (error) {
            console.error('无法访问麦克风:', error);
            alert('无法访问麦克风，请确保已授予权限');
        }
    }

    stopRecording() {
        if (!this.isRecording) return;
        
        this.isRecording = false;
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        
        this.recordCircleBtn.classList.remove('recording');
        this.stopRecordBtn.disabled = true;
        
        if (this.recordAnimationFrame) {
            cancelAnimationFrame(this.recordAnimationFrame);
        }
    }

    drawWaveform() {
        if (!this.isRecording || !this.analyser) return;
        
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteTimeDomainData(dataArray);
        
        const ctx = this.waveformCtx;
        const width = this.waveformWidth;
        const height = this.waveformHeight;
        
        ctx.fillStyle = 'rgba(26, 26, 26, 0.3)';
        ctx.fillRect(0, 0, width, height);
        
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#6366f1';
        ctx.beginPath();
        
        const sliceWidth = width / bufferLength;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * height;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
            
            x += sliceWidth;
        }
        
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        
        this.recordAnimationFrame = requestAnimationFrame(() => this.drawWaveform());
    }

    updateRecordTime() {
        if (!this.isRecording) return;
        
        const elapsed = (Date.now() - this.recordStartTime) / 1000;
        this.recordTimeEl.textContent = this.formatTime(elapsed);
        
        setTimeout(() => this.updateRecordTime(), 50);
    }

    playRecording() {
        if (!this.currentRecording || this.isPlayingRecording) return;
        
        this.isPlayingRecording = true;
        
        const source = this.audioEngine.audioContext.createBufferSource();
        source.buffer = this.currentRecording.audioBuffer;
        source.connect(this.audioEngine.audioContext.destination);
        
        source.onended = () => {
            this.isPlayingRecording = false;
        };
        
        source.start(0);
        this.playbackSource = source;
    }

    stopPlayback() {
        if (this.playbackSource) {
            try {
                this.playbackSource.stop();
            } catch (e) {}
            this.playbackSource = null;
        }
        this.isPlayingRecording = false;
    }

    saveRecording() {
        if (!this.currentRecording) return;
        
        const wav = this.bufferToWav(this.currentRecording.audioBuffer);
        const blob = new Blob([wav], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentRecording.name}.wav`;
        a.click();
        
        URL.revokeObjectURL(url);
    }

    updateRecordingsList() {
        if (!this.recordingsList) return;
        
        if (this.recordings.length === 0) {
            this.recordingsList.innerHTML = `
                <div class="empty-recordings">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="6"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <p>暂无录音</p>
                    <p>点击红色按钮开始录音</p>
                </div>
            `;
            return;
        }
        
        this.recordingsList.innerHTML = this.recordings.map((rec, index) => `
            <div class="recording-item" data-index="${index}">
                <div class="recording-item-header">
                    <span class="recording-item-name">${rec.name}</span>
                    <div class="recording-item-actions">
                        <button class="play-btn" title="播放">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5,3 19,12 5,21"/>
                            </svg>
                        </button>
                        <button class="download-btn" title="下载">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                <polyline points="7,10 12,15 17,10"/>
                                <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                        </button>
                        <button class="delete" title="删除">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="recording-item-info">
                    <span>${this.formatTime(rec.duration)}</span>
                    <span>${rec.createdAt.toLocaleTimeString()}</span>
                </div>
            </div>
        `).join('');
        
        this.recordingsList.querySelectorAll('.recording-item').forEach(item => {
            const index = parseInt(item.dataset.index);
            
            item.querySelector('.play-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.playRecordingByIndex(index);
            });
            
            item.querySelector('.download-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.downloadRecordingByIndex(index);
            });
            
            item.querySelector('.delete').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteRecordingByIndex(index);
            });
            
            item.addEventListener('click', () => {
                this.selectRecording(index);
            });
        });
    }

    selectRecording(index) {
        this.recordingsList.querySelectorAll('.recording-item').forEach((item, i) => {
            item.classList.toggle('selected', i === index);
        });
        
        this.currentRecording = this.recordings[index];
        this.playRecordBtn.disabled = false;
        this.saveRecordingBtn.disabled = false;
    }

    playRecordingByIndex(index) {
        const recording = this.recordings[index];
        if (!recording) return;
        
        this.stopPlayback();
        this.isPlayingRecording = true;
        
        const source = this.audioEngine.audioContext.createBufferSource();
        source.buffer = recording.audioBuffer;
        source.connect(this.audioEngine.audioContext.destination);
        
        source.onended = () => {
            this.isPlayingRecording = false;
        };
        
        source.start(0);
        this.playbackSource = source;
    }

    downloadRecordingByIndex(index) {
        const recording = this.recordings[index];
        if (!recording) return;
        
        const wav = this.bufferToWav(recording.audioBuffer);
        const blob = new Blob([wav], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${recording.name}.wav`;
        a.click();
        
        URL.revokeObjectURL(url);
    }

    deleteRecordingByIndex(index) {
        this.recordings.splice(index, 1);
        this.updateRecordingsList();
        this.updateRecordingCount();
        
        if (this.recordings.length === 0) {
            this.currentRecording = null;
            this.playRecordBtn.disabled = true;
            this.saveRecordingBtn.disabled = true;
        }
    }

    updateRecordingCount() {
        if (this.recordingCountEl) {
            this.recordingCountEl.textContent = `${this.recordings.length} 个录音`;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const studio = new MusicStudio();
    
    document.getElementById('audioFileInput').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file && studio.selectedTrack) {
            await studio.loadAudioToTrack(file, studio.selectedTrack);
        }
        e.target.value = '';
    });
    
    const seqSoundFileInput = document.getElementById('seqSoundFileInput');
    if (seqSoundFileInput) {
        seqSoundFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await studio.loadCustomSound(file);
            }
            e.target.value = '';
        });
    }
});
