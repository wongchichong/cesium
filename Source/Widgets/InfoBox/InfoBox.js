/*global define*/
define([
        '../../Core/buildModuleUrl',
        '../../Core/defined',
        '../../Core/defineProperties',
        '../../Core/destroyObject',
        '../../Core/DeveloperError',
        '../../ThirdParty/knockout',
        '../getElement',
        './InfoBoxViewModel',
        '../subscribeAndEvaluate'
    ], function(
        buildModuleUrl,
        defined,
        defineProperties,
        destroyObject,
        DeveloperError,
        knockout,
        getElement,
        InfoBoxViewModel,
        subscribeAndEvaluate) {
    "use strict";

    /**
     * A widget for displaying information or a description.
     *
     * @alias InfoBox
     * @constructor
     *
     * @param {Element|String} container The DOM element or ID that will contain the widget.
     *
     * @exception {DeveloperError} Element with id "container" does not exist in the document.
     */
    var InfoBox = function(container) {
        //>>includeStart('debug', pragmas.debug);
        if (!defined(container)) {
            throw new DeveloperError('container is required.');
        }
        //>>includeEnd('debug')

        container = getElement(container);

        this._container = container;

        var infoElement = document.createElement('div');
        infoElement.className = 'cesium-infoBox';
        infoElement.setAttribute('data-bind', '\
css: { "cesium-infoBox-visible" : showInfo, "cesium-infoBox-bodyless" : _bodyless }');
        container.appendChild(infoElement);
        this._element = infoElement;

        var titleElement = document.createElement('div');
        titleElement.className = 'cesium-infoBox-title';
        titleElement.setAttribute('data-bind', 'text: titleText');
        infoElement.appendChild(titleElement);

        var cameraElement = document.createElement('button');
        cameraElement.type = 'button';
        cameraElement.className = 'cesium-button cesium-infoBox-camera';
        cameraElement.setAttribute('data-bind', '\
attr: { title: "Focus camera on object" },\
click: function () { cameraClicked.raiseEvent(this); },\
enable: enableCamera,\
cesiumSvgPath: { path: cameraIconPath, width: 32, height: 32 }');
        infoElement.appendChild(cameraElement);

        var closeElement = document.createElement('button');
        closeElement.type = 'button';
        closeElement.className = 'cesium-infoBox-close';
        closeElement.setAttribute('data-bind', '\
click: function () { closeClicked.raiseEvent(this); }');
        closeElement.innerHTML = '&times;';
        infoElement.appendChild(closeElement);

        var infoBodyElement = document.createElement('div');
        infoBodyElement.className = 'cesium-infoBox-body';
        infoElement.appendChild(infoBodyElement);

        var frame = document.createElement('iframe');
        frame.className = 'cesium-infoBox-iframe';
        frame.setAttribute('sandbox', 'allow-same-origin'); //allow-forms allow-popups allow-pointer-lock allow-scripts allow-popups
        frame.setAttribute('data-bind', 'style : { maxHeight : maxHeightOffset(40) }');
        infoBodyElement.appendChild(frame);

        var viewModel = new InfoBoxViewModel();
        this._viewModel = viewModel;
        knockout.applyBindings(this._viewModel, infoElement);

        //CSS to be loaded into the description
        var cssLink = document.createElement("link");
        cssLink.href = buildModuleUrl('Widgets/InfoBox/InfoBoxDescription.css');
        cssLink.rel = "stylesheet";
        cssLink.type = "text/css";

        //div to use for actual content.
        var frameContent = document.createElement("div");
        frameContent.className = 'cesium-infoBox-description';

        //Add items to iframe
        var frameDocument = frame.contentDocument;
        frameDocument.head.appendChild(cssLink);
        frameDocument.body.appendChild(frameContent);

        subscribeAndEvaluate(viewModel, 'processedDescription', function(value) {
            frameContent.innerHTML = value;
            if (value === '') {
                frame.style.display = 'none';
            } else {
                frame.style.display = 'block';
                var rect = frameContent.getBoundingClientRect();
                frame.style.height = rect.height + 'px';
            }
        });
    };

    defineProperties(InfoBox.prototype, {
        /**
         * Gets the parent container.
         * @memberof InfoBox.prototype
         *
         * @type {Element}
         */
        container : {
            get : function() {
                return this._container;
            }
        },

        /**
         * Gets the view model.
         * @memberof InfoBox.prototype
         *
         * @type {SelectionIndicatorViewModel}
         */
        viewModel : {
            get : function() {
                return this._viewModel;
            }
        }
    });

    /**
     * @returns {Boolean} true if the object has been destroyed, false otherwise.
     */
    InfoBox.prototype.isDestroyed = function() {
        return false;
    };

    /**
     * Destroys the widget.  Should be called if permanently
     * removing the widget from layout.
     */
    InfoBox.prototype.destroy = function() {
        var container = this._container;
        knockout.cleanNode(this._element);
        container.removeChild(this._element);
        return destroyObject(this);
    };

    return InfoBox;
});