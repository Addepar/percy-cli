(function() {
  (function (exports) {
    'use strict';

    const process = (typeof globalThis !== "undefined" && globalThis.process) || {};
    process.env = process.env || {};
    process.env.__PERCY_BROWSERIFIED__ = true;

    // Returns a mostly random uid.
    function uid() {
      return `_${Math.random().toString(36).substr(2, 9)}`;
    } // Marks elements that are to be serialized later with a data attribute.


    function prepareDOM(dom) {
      for (let elem of dom.querySelectorAll('input, textarea, select, iframe, canvas, video, style')) {
        if (!elem.getAttribute('data-percy-element-id')) {
          elem.setAttribute('data-percy-element-id', uid());
        }
      }
    }

    // Translates JavaScript properties of inputs into DOM attributes.
    function serializeInputElements(dom, clone) {
      for (let elem of dom.querySelectorAll('input, textarea, select')) {
        let inputId = elem.getAttribute('data-percy-element-id');
        let cloneEl = clone.querySelector(`[data-percy-element-id="${inputId}"]`);

        switch (elem.type) {
          case 'checkbox':
          case 'radio':
            if (elem.checked) {
              cloneEl.setAttribute('checked', '');
            }

            break;

          case 'select-one':
            if (elem.selectedIndex !== -1) {
              cloneEl.options[elem.selectedIndex].setAttribute('selected', 'true');
            }

            break;

          case 'select-multiple':
            for (let option of elem.selectedOptions) {
              cloneEl.options[option.index].setAttribute('selected', 'true');
            }

            break;

          case 'textarea':
            cloneEl.innerHTML = elem.value;
            break;

          default:
            cloneEl.setAttribute('value', elem.value);
        }
      }
    }

    // embedded documents are serialized and their contents become root-relative.

    function setBaseURI(dom) {
      if (!new URL(dom.baseURI).hostname) return;
      let $base = document.createElement('base');
      $base.href = dom.baseURI;
      dom.querySelector('head').prepend($base);
    } // Recursively serializes iframe documents into srcdoc attributes.


    function serializeFrames(dom, clone, _ref) {
      let {
        enableJavaScript
      } = _ref;

      for (let frame of dom.querySelectorAll('iframe')) {
        let percyElementId = frame.getAttribute('data-percy-element-id');
        let cloneEl = clone.querySelector(`[data-percy-element-id="${percyElementId}"]`);
        let builtWithJs = !frame.srcdoc && (!frame.src || frame.src.split(':')[0] === 'javascript'); // delete frames within the head since they usually break pages when
        // rerendered and do not effect the visuals of a page

        if (clone.head.contains(cloneEl)) {
          cloneEl.remove(); // if the frame document is accessible and not empty, we can serialize it
        } else if (frame.contentDocument && frame.contentDocument.documentElement) {
          // js is enabled and this frame was built with js, don't serialize it
          if (enableJavaScript && builtWithJs) continue; // the frame has yet to load and wasn't built with js, it is unsafe to serialize

          if (!builtWithJs && !frame.contentWindow.performance.timing.loadEventEnd) continue; // recersively serialize contents

          let serialized = serializeDOM({
            domTransformation: setBaseURI,
            dom: frame.contentDocument,
            enableJavaScript
          }); // assign to srcdoc and remove src

          cloneEl.setAttribute('srcdoc', serialized);
          cloneEl.removeAttribute('src'); // delete inaccessible frames built with js when js is disabled because they
          // break asset discovery by creating non-captured requests that hang
        } else if (!enableJavaScript && builtWithJs) {
          cloneEl.remove();
        }
      }
    }

    // Returns true if a stylesheet is a CSSOM-based stylesheet.
    function isCSSOM(styleSheet) {
      var _styleSheet$ownerNode, _styleSheet$ownerNode2;

      // no href, has a rulesheet, and isn't already in the DOM
      return !styleSheet.href && styleSheet.cssRules && !((_styleSheet$ownerNode = styleSheet.ownerNode) !== null && _styleSheet$ownerNode !== void 0 && (_styleSheet$ownerNode2 = _styleSheet$ownerNode.innerText) !== null && _styleSheet$ownerNode2 !== void 0 && _styleSheet$ownerNode2.trim().length);
    } // Outputs in-memory CSSOM into their respective DOM nodes.


    function serializeCSSOM(dom, clone) {
      for (let styleSheet of dom.styleSheets) {
        if (isCSSOM(styleSheet)) {
          let style = clone.createElement('style');
          let styleId = styleSheet.ownerNode.getAttribute('data-percy-element-id');
          let cloneOwnerNode = clone.querySelector(`[data-percy-element-id="${styleId}"]`);
          style.type = 'text/css';
          style.setAttribute('data-percy-cssom-serialized', 'true');
          style.innerHTML = Array.from(styleSheet.cssRules).reduce((prev, cssRule) => prev + cssRule.cssText, '');
          cloneOwnerNode.parentNode.insertBefore(style, cloneOwnerNode.nextSibling);
        }
      }
    }

    // Serialize in-memory canvas elements into images.
    function serializeCanvas(dom, clone) {
      for (let canvas of dom.querySelectorAll('canvas')) {
        // Note: the `.toDataURL` API requires WebGL canvas elements to use
        // `preserveDrawingBuffer: true`. This is because `.toDataURL` uses the
        // drawing buffer, which is cleared after each render for WebGL by default.
        let dataUrl = canvas.toDataURL(); // skip empty canvases

        if (!dataUrl || dataUrl === 'data:,') continue; // create an image element in the cloned dom

        let img = dom.createElement('img');
        img.src = dataUrl; // copy canvas element attributes to the image element such as style, class,
        // or data attributes that may be targeted by CSS

        for (let {
          name,
          value
        } of canvas.attributes) {
          img.setAttribute(name, value);
        } // mark the image as serialized (can be targeted by CSS)


        img.setAttribute('data-percy-canvas-serialized', ''); // set a default max width to account for canvases that might resize with JS

        img.style.maxWidth = img.style.maxWidth || '100%'; // insert the image into the cloned DOM and remove the cloned canvas element

        let percyElementId = canvas.getAttribute('data-percy-element-id');
        let cloneEl = clone.querySelector(`[data-percy-element-id=${percyElementId}]`);
        cloneEl.parentElement.insertBefore(img, cloneEl);
        cloneEl.remove();
      }
    }

    // Captures the current frame of videos and sets the poster image
    function serializeVideos(dom, clone) {
      for (let video of dom.querySelectorAll('video')) {
        // If the video already has a poster image, no work for us to do
        if (video.getAttribute('poster')) continue;
        let videoId = video.getAttribute('data-percy-element-id');
        let cloneEl = clone.querySelector(`[data-percy-element-id="${videoId}"]`);
        let canvas = document.createElement('canvas');
        let width = canvas.width = video.videoWidth;
        let height = canvas.height = video.videoHeight;
        let dataUrl;
        canvas.getContext('2d').drawImage(video, 0, 0, width, height);

        try {
          dataUrl = canvas.toDataURL();
        } catch {} // If the canvas produces a blank image, skip


        if (!dataUrl || dataUrl === 'data:,') continue;
        cloneEl.setAttribute('poster', dataUrl);
      }
    }

    /**
     * Custom deep clone function that replaces Percy's current clone behavior.
     * This enables us to capture shadow DOM in snapshots. It takes advantage of `attachShadow`'s mode option set to open 
     * https://developer.mozilla.org/en-US/docs/Web/API/Element/attachShadow#parameters
     */
    const deepClone = host => {
      let cloneNode = (node, parent) => {
        let walkTree = (nextn, nextp) => {
          while (nextn) {
            cloneNode(nextn, nextp);
            nextn = nextn.nextSibling;
          }
        };

        let clone = node.cloneNode();
        parent.appendChild(clone);

        if (node.shadowRoot) {
          if (clone.shadowRoot) {
            // it may be set up in a custom element's constructor
            clone.shadowRoot.innerHTML = '';
          } else {
            clone.attachShadow({
              mode: 'open'
            });
          }

          for (let sheet of node.shadowRoot.adoptedStyleSheets) {
            let cssText = Array.from(sheet.rules).map(rule => rule.cssText).join('\n');
            let style = document.createElement('style');
            style.appendChild(document.createTextNode(cssText));
            clone.shadowRoot.prepend(style);
          }
        }

        if (node.shadowRoot) {
          walkTree(node.shadowRoot.firstChild, clone.shadowRoot);
        }

        walkTree(node.firstChild, clone);
      };

      let fragment = document.createDocumentFragment();
      cloneNode(host, fragment);
      return fragment;
    };
    /**
     * Deep clone a document while also preserving shadow roots and converting adoptedStylesheets to <style> tags.
     */


    const cloneNodeAndShadow = doc => {
      let mockDocument = deepClone(doc.documentElement);
      mockDocument.head = document.createDocumentFragment();
      mockDocument.documentElement = mockDocument.firstChild;
      return mockDocument;
    };
    /**
     * Use `getInnerHTML()` to serialize shadow dom as <template> tags. `innerHTML` and `outerHTML` don't do this. Buzzword: "declarative shadow dom"
     */


    const getOuterHTML = docElement => {
      let innerHTML = docElement.getInnerHTML();
      docElement.textContent = '';
      return docElement.outerHTML.replace('</html>', `${innerHTML}</html>`);
    };

    function doctype(dom) {
      let {
        name = 'html',
        publicId = '',
        systemId = ''
      } = (dom === null || dom === void 0 ? void 0 : dom.doctype) ?? {};
      let deprecated = '';

      if (publicId && systemId) {
        deprecated = ` PUBLIC "${publicId}" "${systemId}"`;
      } else if (publicId) {
        deprecated = ` PUBLIC "${publicId}"`;
      } else if (systemId) {
        deprecated = ` SYSTEM "${systemId}"`;
      }

      return `<!DOCTYPE ${name}${deprecated}>`;
    } // Serializes a document and returns the resulting DOM string.


    function serializeDOM(options) {
      let {
        dom = document,
        // allow snake_case or camelCase
        enableJavaScript = options === null || options === void 0 ? void 0 : options.enable_javascript,
        domTransformation = options === null || options === void 0 ? void 0 : options.dom_transformation
      } = options || {};
      prepareDOM(dom);
      let clone = cloneNodeAndShadow(dom);
      serializeInputElements(dom, clone);
      serializeFrames(dom, clone, {
        enableJavaScript
      });
      serializeVideos(dom, clone);

      if (!enableJavaScript) {
        serializeCSSOM(dom, clone);
        serializeCanvas(dom, clone);
      }

      let doc = clone.documentElement;

      if (domTransformation) {
        try {
          domTransformation(doc);
        } catch (err) {
          console.error('Could not transform the dom:', err.message);
        }
      }

      return doctype(dom) + getOuterHTML(doc);
    }

    exports["default"] = serializeDOM;
    exports.serialize = serializeDOM;
    exports.serializeDOM = serializeDOM;

    Object.defineProperty(exports, '__esModule', { value: true });

  })(this.PercyDOM = this.PercyDOM || {});
}).call(window);

if (typeof define === "function" && define.amd) {
  define([], () => window.PercyDOM);
} else if (typeof module === "object" && module.exports) {
  module.exports = window.PercyDOM;
}
