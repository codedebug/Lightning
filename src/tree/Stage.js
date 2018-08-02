/**
 * Application render tree.
 * Copyright Metrological, 2017
 */

const Utils = require('./Utils');
/*M¬*/const EventEmitter = require(Utils.isNode ? 'events' : '../browser/EventEmitter');/*¬M*/

class Stage extends EventEmitter {

    constructor(options = {}) {
        super()
        this._setOptions(options);

        /*M¬*/if (!Utils.isNode) {/*¬M*/this.adapter = new WebAdapter();/*M¬*/}
        if (Utils.isNode) {this.adapter = new NodeAdapter();}/*¬M*/

        if (this.adapter.init) {
            this.adapter.init(this);
        }

        this.gl = this.adapter.createWebGLContext(this.getOption('w'), this.getOption('h'));

        this.setGlClearColor(this._options.glClearColor);

        this.frameCounter = 0;

        this.transitions = new TransitionManager(this);
        this.animations = new AnimationManager(this);

        this.textureManager = new TextureManager(this);

        this.ctx = new CoreContext(this);

        this._destroyed = false;

        this.startTime = 0;
        this.currentTime = 0;
        this.dt = 0;

        // Preload rectangle texture, so that we can skip some border checks for loading textures.
        this.rectangleTexture = new RectangleTexture(this)
        this.rectangleTexture.load();

        // Never clean up because we use it all the time.
        this.rectangleTexture.source.permanent = true

        this._updateSourceTextures = new Set()
    }

    getOption(name) {
        return this._options[name]
    }
    
    _setOptions(o) {
        this._options = {};

        let opt = (name, def) => {
            let value = o[name];

            if (value === undefined) {
                this._options[name] = def;
            } else {
                this._options[name] = value;
            }
        }

        opt('w', 1280);
        opt('h', 720);
        opt('canvas', this._options.canvas);
        opt('srcBasePath', null);
        opt('textureMemory', 18e6);
        opt('renderTextureMemory', 12e6);
        opt('bufferMemory', 8e6);
        opt('textRenderIssueMargin', 0);
        opt('glClearColor', [0, 0, 0, 0]);
        opt('defaultFontFace', 'Sans-Serif');
        opt('fixedDt', 0);
        opt('useTextureAtlas', false);
        opt('debugTextureAtlas', false);
        opt('useImageWorker', false);
        opt('precision', 1);
    }
    
    setApplication(app) {
        this.application = app
    }

    init() {
        this.application.setAsRoot();
        this.adapter.startLoop()
    }

    destroy() {
        this.adapter.stopLoop();
        this.ctx.destroy();
        this.textureManager.destroy();
        this._destroyed = true;
    }

    stop() {
        this.adapter.stopLoop();
    }

    resume() {
        if (this._destroyed) {
            throw new Error("Already destroyed")
        }
        this.adapter.startLoop();
    }

    get root() {
        return this.application
    }

    getCanvas() {
        return this.adapter.getWebGLCanvas()
    }

    getRenderPrecision() {
        return this._options.precision;
    }

    /**
     * Marks a texture for updating it's source upon the next drawFrame.
     * @param texture
     */
    addUpdateSourceTexture(texture) {
        if (this._updatingFrame) {
            // When called from the upload loop, we must immediately load the texture in order to avoid a 'flash'.
            texture._performUpdateSource()
        } else {
            this._updateSourceTextures.add(texture)
        }
    }

    removeUpdateSourceTexture(texture) {
        if (this._updateSourceTextures) {
            this._updateSourceTextures.delete(texture)
        }
    }

    drawFrame() {
        if (this._options.fixedDt) {
            this.dt = this._options.fixedDt;
        } else {
            this.dt = (!this.startTime) ? .02 : .001 * (this.currentTime - this.startTime);
        }
        this.startTime = this.currentTime;
        this.currentTime = (new Date()).getTime();

        this.emit('frameStart');

        if (this.textureManager.isFull()) {
            this.textureManager.freeUnusedTextureSources();
        }

        if (this._updateSourceTextures.size) {
            this._updateSourceTextures.forEach(texture => {
                texture._performUpdateSource()
            })
            this._updateSourceTextures = new Set()
        }

        this.emit('update');

        const changes = this.ctx.hasRenderUpdates()

        if (changes) {
            this._updatingFrame = true
            this.ctx.frame();
            this._updatingFrame = false
        }

        this.adapter.nextFrame(changes);

        this.emit('frameEnd');

        this.frameCounter++;
    }

    renderFrame() {
        this.ctx.frame()
    }

    forceRenderUpdate() {
        // Enfore re-rendering.
        if (this.root) {
            this.root.core._parent._hasRenderUpdates = true
        }
    }

    setGlClearColor(clearColor) {
        this.forceRenderUpdate()
        if (Array.isArray(clearColor)) {
            this._options.glClearColor = clearColor;
        } else {
            this._options.glClearColor = StageUtils.getRgbaComponentsNormalized(clearColor);
        }
    }

    createView() {
        return new View(this);
    }

    view(settings) {
        if (settings.isView) return settings;

        let view;
        if (settings.type) {
            view = new settings.type(this);
        } else {
            view = new View(this);
        }

        view.patch(settings, true)

        return view;
    }

    c(settings) {
        return this.view(settings);
    }

    get w() {
        return this._options.w
    }

    get h() {
        return this._options.h
    }

    get rw() {
        return this.w / this._options.precision
    }

    get rh() {
        return this.h / this._options.precision
    }

    gcTextureMemory(aggressive = false) {
        console.log("GC texture memory" + (aggressive ? " (aggressive)" : ""))
        if (aggressive && this.ctx.root.visible) {
            // Make sure that ALL textures are cleaned
            this.ctx.root.visible = false
            this.textureManager.freeUnusedTextureSources()
            this.ctx.root.visible = true
        } else {
            this.textureManager.freeUnusedTextureSources()
        }
    }

    gcRenderTextureMemory(aggressive = false) {
        console.log("GC texture render memory" + (aggressive ? " (aggressive)" : ""))
        if (aggressive && this.root.visible) {
            // Make sure that ALL render textures are cleaned
            this.root.visible = false
            this.ctx.freeUnusedRenderTextures(0)
            this.root.visible = true
        } else {
            this.ctx.freeUnusedRenderTextures(0)
        }
    }

    getDrawingCanvas() {
        return this.adapter.getDrawingCanvas()
    }

}

module.exports = Stage;

const View = require('./View');
const StageUtils = require('./StageUtils');
const TextureManager = require('./TextureManager');
const CoreContext = require('./core/CoreContext');
const TransitionManager = require('../animation/TransitionManager');
const AnimationManager = require('../animation/AnimationManager');
/*M¬*/
const WebAdapter = Utils.isNode ? undefined : require('../browser/WebAdapter');
const NodeAdapter = Utils.isNode ? require('../node/NodeAdapter') : null;
/*¬M*/
const Application = require('../application/Application')
const RectangleTexture = require('../textures/RectangleTexture')