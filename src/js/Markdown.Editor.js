"use strict";
var CaretPosition = require('textarea-caret-position');
var Markdown = {};
module.exports = Markdown;

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/Trim
if (!String.prototype.trim) {
  String.prototype.trim = function () {
	return this.replace(/^\s+|\s+$/g, '');
  };
}

(function (Markdown) {

	var util = {},
		position = {},
		doc = window.document,
		re = window.RegExp,
		nav = window.navigator,
		SETTINGS = { lineLength: 72 },
		editor,

	// Used to work around some browser bugs where we can't use feature testing.
		uaSniffed = {
			isIE: /msie/.test(nav.userAgent.toLowerCase()),
			isIE_5or6: /msie 6/.test(nav.userAgent.toLowerCase()) || /msie 5/.test(nav.userAgent.toLowerCase()),
			isOpera: /opera/.test(nav.userAgent.toLowerCase())
		};

	var defaultsStrings = {
		boldexample: "strong text",
		italicexample: "italic text",
		linkdescription: "enter link description here",
		linkdialog: "<p><b>Insert Hyperlink</b></p><p>http://example.com/ \"optional title\"</p>",
		quoteexample: "Blockquote",
		codeexample: "enter code here",
		imagedescription: "enter image description here",
		imagedialog: "<p><b>Insert Image</b></p><p>http://example.com/images/diagram.jpg \"optional title\"<br><br>Need <a href='http://www.google.com/search?q=free+image+hosting' target='_blank'>free image hosting?</a></p>",
		headingexample: "Heading"
	};


	// -------------------------------------------------------------------
	//  YOUR CHANGES GO HERE
	//
	// I've tried to localize the things you are likely to change to
	// this area.
	// -------------------------------------------------------------------

	// The default text that appears in the dialog input box when entering
	// links.
	var imageDefaultText = "http://";
	var linkDefaultText = "http://";


	function identity(x) { return x; }
	function returnFalse(x) { return false; }

	function HookCollection() { }

	HookCollection.prototype = {

		chain: function (hookname, func) {
			var original = this[hookname];
			if (!original)
				throw new Error("unknown hook " + hookname);

			if (original === identity)
				this[hookname] = func;
			else
				this[hookname] = function (text) {
					var args = Array.prototype.slice.call(arguments, 0);
					args[0] = original.apply(null, args);
					return func.apply(null, args);
				};
		},
		set: function (hookname, func) {
			if (!this[hookname])
				throw new Error("unknown hook " + hookname);
			this[hookname] = func;
		},
		addNoop: function (hookname) {
			this[hookname] = identity;
		},
		addFalse: function (hookname) {
			this[hookname] = returnFalse;
		}
	};

	Markdown.HookCollection = HookCollection;

	// -------------------------------------------------------------------
	//  END OF YOUR CHANGES
	// -------------------------------------------------------------------

	// options, if given, can have the following properties:
	//   options.helpButton = { handler: yourEventHandler }
	//   options.strings = { italicexample: "slanted text" }
	// `yourEventHandler` is the click handler for the help button.
	// If `options.helpButton` isn't given, not help button is created.
	// `options.strings` can have any or all of the same properties as
	// `defaultStrings` above, so you can just override some string displayed
	// to the user on a case-by-case basis, or translate all strings to
	// a different language.
	//
	// For backwards compatibility reasons, the `options` argument can also
	// be just the `helpButton` object, and `strings.help` can also be set via
	// `helpButton.title`. This should be considered legacy.
	//
	// The constructed editor object has the methods:
	// - getConverter() returns the markdown converter object that was passed to the constructor
	// - run() actually starts the editor; should be called after all necessary plugins are registered. Calling this more than once is a no-op.
	Markdown.Editor = function (derbyPageDown) {
		
		var options = {};
		this.derbyPageDown = derbyPageDown;

		if (typeof options.handler === "function") { //backwards compatible behavior
			options = { helpButton: options };
		}
		options.strings = options.strings || {};
		if (options.helpButton) {
			options.strings.help = options.strings.help || options.helpButton.title;
		}

		this.getString = function (identifier) { return options.strings[identifier] || defaultsStrings[identifier]; };


		var hooks = this.hooks = new Markdown.HookCollection();
		hooks.addNoop("postBlockquoteCreation"); // called with the user's selection *after* the blockquote was created; should return the actual to-be-inserted text
		hooks.addFalse("insertImageDialog");     /* called with one parameter: a callback to be called with the URL of the image. If the application creates
												  * its own image insertion dialog, this hook should return true, and the callback should be called with the chosen
												  * image url (or null if the user cancelled). If this hook returns false, the default dialog will be used.
												  */

		editor = this;

		this.run = function () {
			if (this.panels)
				return; // already initialized

			this.panels = new PanelCollection();
			// this.commandManager = new CommandManager(this, hooks);
			this.commandManager = createCommandManager(hooks);

			if (!/\?noundo/.test(doc.location.href)) {
				this.undoManager = new UndoManager(function () { }, this.panels);
				this.textOperation = function (f) {
					editor.undoManager.setCommandMode();
					f();
				};
			}

			this.uiManager = new UIManager(this);
		};

	};

	// before: contains all the text in the input box BEFORE the selection.
	// after: contains all the text in the input box AFTER the selection.
	function Chunks() { }

	// startRegex: a regular expression to find the start tag
	// endRegex: a regular expresssion to find the end tag
	Chunks.prototype.findTags = function (startRegex, endRegex) {

		var chunkObj = this;
		var regex;

		if (startRegex) {
			regex = util.extendRegExp(startRegex, "", "$");

			this.before = this.before.replace(regex, function (match) {
				chunkObj.startTag = chunkObj.startTag + match;
				return "";
			});

			regex = util.extendRegExp(startRegex, "^", "");

			this.selection = this.selection.replace(regex, function (match) {
				chunkObj.startTag = chunkObj.startTag + match;
				return "";
			});
		}

		if (endRegex) {
			regex = util.extendRegExp(endRegex, "", "$");

			this.selection = this.selection.replace(regex, function (match) {
				chunkObj.endTag = match + chunkObj.endTag;
				return "";
			});

			regex = util.extendRegExp(endRegex, "^", "");

			this.after = this.after.replace(regex, function (match) {
				chunkObj.endTag = match + chunkObj.endTag;
				return "";
			});
		}
	};

	// If remove is false, the whitespace is transferred
	// to the before/after regions.
	//
	// If remove is true, the whitespace disappears.
	Chunks.prototype.trimWhitespace = function (remove) {
		var beforeReplacer, afterReplacer, that = this;
		if (remove) {
			beforeReplacer = afterReplacer = "";
		} else {
			beforeReplacer = function (s) { that.before += s; return ""; }
			afterReplacer = function (s) { that.after = s + that.after; return ""; }
		}

		this.selection = this.selection.replace(/^(\s*)/, beforeReplacer).replace(/(\s*)$/, afterReplacer);
	};


	Chunks.prototype.skipLines = function (nLinesBefore, nLinesAfter, findExtraNewlines) {

		if (nLinesBefore === undefined) {
			nLinesBefore = 1;
		}

		if (nLinesAfter === undefined) {
			nLinesAfter = 1;
		}

		nLinesBefore++;
		nLinesAfter++;

		var regexText;
		var replacementText;

		// chrome bug ... documented at: http://meta.stackexchange.com/questions/63307/blockquote-glitch-in-editor-in-chrome-6-and-7/65985#65985
		if (navigator.userAgent.match(/Chrome/)) {
			"X".match(/()./);
		}

		this.selection = this.selection.replace(/(^\n*)/, "");

		this.startTag = this.startTag + re.$1;

		this.selection = this.selection.replace(/(\n*$)/, "");
		this.endTag = this.endTag + re.$1;
		this.startTag = this.startTag.replace(/(^\n*)/, "");
		this.before = this.before + re.$1;
		this.endTag = this.endTag.replace(/(\n*$)/, "");
		this.after = this.after + re.$1;

		if (this.before) {

			regexText = replacementText = "";

			while (nLinesBefore--) {
				regexText += "\\n?";
				replacementText += "\n";
			}

			if (findExtraNewlines) {
				regexText = "\\n*";
			}
			this.before = this.before.replace(new re(regexText + "$", ""), replacementText);
		}

		if (this.after) {

			regexText = replacementText = "";

			while (nLinesAfter--) {
				regexText += "\\n?";
				replacementText += "\n";
			}
			if (findExtraNewlines) {
				regexText = "\\n*";
			}

			this.after = this.after.replace(new re(regexText, ""), replacementText);
		}
	};

	// end of Chunks

	// A collection of the important regions on the page.
	// Cached so we don't have to keep traversing the DOM.
	// Also holds ieCachedRange and ieCachedScrollTop, where necessary; working around
	// this issue:
	// Internet explorer has problems with CSS sprite buttons that use HTML
	// lists.  When you click on the background image "button", IE will
	// select the non-existent link text and discard the selection in the
	// textarea.  The solution to this is to cache the textarea selection
	// on the button's mousedown event and set a flag.  In the part of the
	// code where we need to grab the selection, we check for the flag
	// and, if it's set, use the cached area instead of querying the
	// textarea.
	//
	// This ONLY affects Internet Explorer (tested on versions 6, 7
	// and 8) and ONLY on button clicks.  Keyboard shortcuts work
	// normally since the focus never leaves the textarea.
	function PanelCollection() {
		var self = this,
			id = 'wmd-button-bar';

		this.input = editor.derbyPageDown.input;
		this.caretPosition = new CaretPosition(this.input);
		this.toolbar = doc.getElementById(id);

		this.link = (function() {
			var dialog = document.getElementById('wmd-button-row-link'),
				input = document.getElementById('wmd-button-row-link').querySelector('input'),
				closeButton = document.getElementById('wmd-button-row-link').querySelector('i'),
				callback;

			closeButton.addEventListener('click', function(e) {
				close(true);
			});

			input.addEventListener('keypress', function(e) {
				var charCode = e.keyCode || e.which;

				if (charCode === 13) {
					e.preventDefault();
					e.stopPropagation();
					close(false);
				}
			});
					
			// Used as a keydown event handler. Esc dismisses the prompt.
			// Key code 27 is ESC.
			function checkEscape(key) {
				var code = (key.charCode || key.keyCode);
				if (code === 27) {
					key.preventDefault();
					if (key.stopPropagation) key.stopPropagation();
					close(true);
					return false;
				}
			}

			function close(isCancel) {
				util.removeEvent(document.body, "keyup", checkEscape);
				var text = input.value;

				if (isCancel) {
					text = null;
				}

				self.toolbar.hide('link');
				callback(text);
				return false;
			}

			return function(value, cb) {
				input.value = value;
				callback = cb;
				util.addEvent(document.body, "keyup", checkEscape);
				self.toolbar.show('link');
				input.focus();
			};
		}());

		this.toolbar.contains = function(n) {
			if (n) {
				if (n.id === id) {
					return true;
				}

				if (n.parentNode) {
					if (n.parentNode.id === id) {
						return true;
					}

					if (n.parentNode.parentNode) {
						if (n.parentNode.parentNode.id === id) {
							return true;
						}

						if (n.parentNode.parentNode.parentNode && n.parentNode.parentNode.parentNode.id === id) {
							return true;
						}
					}
				}
			}
		};

		this.toolbar.show = function(which) {
			which = which || 'buttons';

			// console.log('this.toolbar.show')

			function selectionEqual(sel1, sel2) {
				if (!sel1) return;
				if (!sel1.length !== 1) return;

				if (sel1[0] === sel2[0] && sel1[1] === sel2[1]) {
					return true;
				}
			}

			function calculatePosition() {
				var boundary = self.caretPosition.get(self.input.selectionStart, self.input.selectionEnd),
					middleBoundary = (boundary.right + boundary.left) / 2,
					halfWidth = (this.offsetWidth || 166) / 2;

				// console.log(boundary);
				// console.log('left: '+(middleBoundary - halfWidth));
				// console.log('middleBoundary: '+middleBoundary);
				// console.log('halfWidth: '+halfWidth);

				// save the selection info for later use
				this.sel = [ self.input.selectionStart, self.input.selectionEnd ];
				this.style.top = (boundary.top - 50) + 'px';
				this.style.left = (middleBoundary - halfWidth) + 'px';
			}

			// showing but selection has changed
			// if (this.className.indexOf('show-' + which) !== -1 &&
			var attr = this.getAttribute('data-show');
			if (attr === which &&
				!selectionEqual(this.sel, [ self.input.selectionStart, self.input.selectionEnd ])) {
				calculatePosition.call(this);
			}
			else {
				this.setAttribute('data-show', which);
				calculatePosition.call(this);
				this.setAttribute('data-show-on', 1);
				// console.log('set data-show-on 1')
			}
		};

		this.toolbar.hide = function() {
			this.removeAttribute('data-show');
			this.removeAttribute('data-show-on');
		};

		this.input.clearSelection = function() {
			self.input.selectionEnd = self.input.selectionStart;
		};

		function showToolbarIfNeeded(e) {
			// console.log('showToolbarIfNeeded');
			setTimeout(function () {
				var sel = self.input.selectionEnd - self.input.selectionStart;

				// show toolbar if text is selected
				if (sel) {
					editor.panels.toolbar.show();
				}
				else {
					editor.panels.toolbar.hide();
				}
			}, 0);
		}

		util.addEvent(this.input, 'keydown', function(e) {
			var keyCode = e.charCode || e.keyCode;

			// clear selection
			if (keyCode === 27) {
				self.input.clearSelection();
			}
		});

		util.addEvent(this.input, 'keyup', showToolbarIfNeeded);
		util.addEvent(document, 'mousedown', function(e) {
			var t = e.srcElement || e.target;

			if (!self.toolbar.contains(t)) {
				self.toolbar.hide.call(self.toolbar);
			}
		});
		util.addEvent(this.input, 'mouseup', showToolbarIfNeeded);
	}

	// Returns true if the DOM element is visible, false if it's hidden.
	// Checks if display is anything other than none.
	util.isVisible = function (elem) {

		if (window.getComputedStyle) {
			// Most browsers
			return window.getComputedStyle(elem, null).getPropertyValue("display") !== "none";
		}
		else if (elem.currentStyle) {
			// IE
			return elem.currentStyle["display"] !== "none";
		}
	};

	// for derby to take notice of the changed content
	util.fireInputEvent = function(){
		var evt;

		if (document.createEventObject){
			// dispatch for IE
			evt = document.createEventObject();
			return editor.input.fireEvent('oninput',evt)
		}
		else{
			// dispatch for firefox + others
			evt = document.createEvent("HTMLEvents");
			evt.initEvent('input', true, true ); // event type,bubbling,cancelable
			return !editor.panels.input.dispatchEvent(evt);
		}
	};

	// Adds a listener callback to a DOM element which is fired on a specified
	// event.
	util.addEvent = function (elem, event, listener) {
		if (elem.attachEvent) {
			// IE only.  The "on" is mandatory.
			elem.attachEvent("on" + event, listener);
		}
		else {
			// Other browsers.
			elem.addEventListener(event, listener, false);
		}
	};


	// Removes a listener callback from a DOM element which is fired on a specified
	// event.
	util.removeEvent = function (elem, event, listener) {
		if (elem.detachEvent) {
			// IE only.  The "on" is mandatory.
			elem.detachEvent("on" + event, listener);
		}
		else {
			// Other browsers.
			elem.removeEventListener(event, listener, false);
		}
	};

	// Converts \r\n and \r to \n.
	util.fixEolChars = function (text) {
		text = text.replace(/\r\n/g, "\n");
		text = text.replace(/\r/g, "\n");
		return text;
	};

	// Extends a regular expression.  Returns a new RegExp
	// using pre + regex + post as the expression.
	// Used in a few functions where we have a base
	// expression and we want to pre- or append some
	// conditions to it (e.g. adding "$" to the end).
	// The flags are unchanged.
	//
	// regex is a RegExp, pre and post are strings.
	util.extendRegExp = function (regex, pre, post) {

		if (pre === null || pre === undefined) {
			pre = "";
		}
		if (post === null || post === undefined) {
			post = "";
		}

		var pattern = regex.toString();
		var flags;

		// Replace the flags with empty space and store them.
		pattern = pattern.replace(/\/([gim]*)$/, function (wholeMatch, flagsPart) {
			flags = flagsPart;
			return "";
		});

		// Remove the slash delimiters on the regular expression.
		pattern = pattern.replace(/(^\/|\/$)/g, "");
		pattern = pre + pattern + post;

		return new re(pattern, flags);
	};

	util.escapeRegExp = function (string) {
		return string.replace(/([.*+?^${}()|\[\]\/\\])/g, "\\$1");
	};

	position.getHeight = function (elem) {
		return elem.offsetHeight || elem.scrollHeight;
	};

	position.getWidth = function (elem) {
		return elem.offsetWidth || elem.scrollWidth;
	};

	// Handles pushing and popping TextareaStates for undo/redo commands.
	// I should rename the stack variables to list.
	function UndoManager(callback, panels) {

		var undoObj = this;
		var undoStack = []; // A stack of undo states
		var stackPtr = 0; // The index of the current state
		var mode = "none";
		var lastState; // The last state
		var timer; // The setTimeout handle for cancelling the timer
		var inputStateObj;

		// Set the mode for later logic steps.
		var setMode = function (newMode, noSave) {
			if (mode != newMode) {
				mode = newMode;
				if (!noSave) {
					saveState();
				}
			}

			if (!uaSniffed.isIE || mode != "moving") {
				timer = setTimeout(refreshState, 1);
			}
			else {
				inputStateObj = null;
			}
		};

		var refreshState = function (isInitialState) {
			inputStateObj = new TextareaState(panels, isInitialState);
			timer = undefined;
		};

		this.setCommandMode = function () {
			mode = "command";
			saveState();
			timer = setTimeout(refreshState, 0);
		};

		this.canUndo = function () {
			return stackPtr > 1;
		};

		this.canRedo = function () {
			if (undoStack[stackPtr + 1]) {
				return true;
			}
			return false;
		};

		// Removes the last state and restores it.
		this.undo = function () {

			if (undoObj.canUndo()) {
				if (lastState) {
					// What about setting state -1 to null or checking for undefined?
					lastState.restore();
					lastState = null;
				}
				else {
					undoStack[stackPtr] = new TextareaState(panels);
					undoStack[--stackPtr].restore();

					if (callback) {
						callback();
					}
				}
			}

			mode = "none";
			panels.input.focus();
			refreshState();
		};

		// Redo an action.
		this.redo = function () {
			if (undoObj.canRedo()) {

				undoStack[++stackPtr].restore();

				if (callback) {
					callback();
				}
			}

			mode = "none";
			panels.input.focus();
			refreshState();
		};

		// Push the input area state to the stack.
		var saveState = function () {
			var currState = inputStateObj || new TextareaState(panels);

			if (!currState) {
				return false;
			}
			if (mode == "moving") {
				if (!lastState) {
					lastState = currState;
				}
				return;
			}
			if (lastState) {
				if (undoStack[stackPtr - 1].text != lastState.text) {
					undoStack[stackPtr++] = lastState;
				}
				lastState = null;
			}
			undoStack[stackPtr++] = currState;
			undoStack[stackPtr + 1] = null;
			if (callback) {
				callback();
			}
		};

		var handleCtrlYZ = function (event) {

			var handled = false;

			if ((event.ctrlKey || event.metaKey) && !event.altKey) {

				// IE and Opera do not support charCode.
				var keyCode = event.charCode || event.keyCode;
				var keyCodeChar = String.fromCharCode(keyCode);

				switch (keyCodeChar.toLowerCase()) {

					case "y":
						undoObj.redo();
						handled = true;
						break;

					case "z":
						if (!event.shiftKey) {
							undoObj.undo();
						}
						else {
							undoObj.redo();
						}
						handled = true;
						break;
				}
			}

			if (handled) {
				if (event.preventDefault) {
					event.preventDefault();
				}
				if (window.event) {
					window.event.returnValue = false;
				}
				return;
			}
		};

		// Set the mode depending on what is going on in the input area.
		var handleModeChange = function (event) {

			if (!event.ctrlKey && !event.metaKey) {

				var keyCode = event.keyCode;

				if ((keyCode >= 33 && keyCode <= 40) || (keyCode >= 63232 && keyCode <= 63235)) {
					// 33 - 40: page up/dn and arrow keys
					// 63232 - 63235: page up/dn and arrow keys on safari
					setMode("moving");
				}
				else if (keyCode == 8 || keyCode == 46 || keyCode == 127) {
					// 8: backspace
					// 46: delete
					// 127: delete
					setMode("deleting");
				}
				else if (keyCode == 13) {
					// 13: Enter
					setMode("newlines");
				}
				else if (keyCode == 27) {
					// 27: escape
					setMode("escape");
				}
				else if ((keyCode < 16 || keyCode > 20) && keyCode != 91) {
					// 16-20 are shift, etc.
					// 91: left window key
					// I think this might be a little messed up since there are
					// a lot of nonprinting keys above 20.
					setMode("typing");
				}
			}
		};

		var setEventHandlers = function () {
			util.addEvent(panels.input, "keypress", function (event) {
				// keyCode 89: y
				// keyCode 90: z
				if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.keyCode == 89 || event.keyCode == 90)) {
					event.preventDefault();
				}
			});

			var handlePaste = function () {
				if (uaSniffed.isIE || (inputStateObj && inputStateObj.text != panels.input.value)) {
					if (timer === undefined) {
						mode = "paste";
						saveState();
						refreshState();
					}
				}
			};

			util.addEvent(panels.input, "keydown", handleCtrlYZ);
			util.addEvent(panels.input, "keydown", handleModeChange);
			util.addEvent(panels.input, "mousedown", function () {
				setMode("moving");
			});

			panels.input.onpaste = handlePaste;
			panels.input.ondrop = handlePaste;
		};

		var init = function () {
			setEventHandlers();
			refreshState(true);
			saveState();
		};

		init();
	}

	// end of UndoManager

	// The input textarea state/contents.
	// This is used to implement undo/redo by the undo manager.
	function TextareaState(panels, isInitialState) {

		// Aliases
		var stateObj = this;
		var inputArea = panels.input;
		this.init = function () {
			if (!util.isVisible(inputArea)) {
				return;
			}
			if (!isInitialState && doc.activeElement && doc.activeElement !== inputArea) { // this happens when tabbing out of the input box
				return;
			}

			this.setInputAreaSelectionStartEnd();
			this.scrollTop = inputArea.scrollTop;
			if (!this.text && inputArea.selectionStart || inputArea.selectionStart === 0) {
				this.text = inputArea.value;
			}

		}

		// Sets the selected text in the input box after we've performed an
		// operation.
		this.setInputAreaSelection = function () {

			if (!util.isVisible(inputArea)) {
				return;
			}

			if (inputArea.selectionStart !== undefined && !uaSniffed.isOpera) {

				inputArea.focus();
				inputArea.selectionStart = stateObj.start;
				inputArea.selectionEnd = stateObj.end;
				inputArea.scrollTop = stateObj.scrollTop;
			}
			else if (doc.selection) {

				if (doc.activeElement && doc.activeElement !== inputArea) {
					return;
				}

				inputArea.focus();
				var range = inputArea.createTextRange();
				range.moveStart("character", -inputArea.value.length);
				range.moveEnd("character", -inputArea.value.length);
				range.moveEnd("character", stateObj.end);
				range.moveStart("character", stateObj.start);
				range.select();
			}
		};

		this.setInputAreaSelectionStartEnd = function () {

			if (!panels.ieCachedRange && (inputArea.selectionStart || inputArea.selectionStart === 0)) {

				stateObj.start = inputArea.selectionStart;
				stateObj.end = inputArea.selectionEnd;
			}
			else if (doc.selection) {

				stateObj.text = util.fixEolChars(inputArea.value);

				// IE loses the selection in the textarea when buttons are
				// clicked.  On IE we cache the selection. Here, if something is cached,
				// we take it.
				var range = panels.ieCachedRange || doc.selection.createRange();

				var fixedRange = util.fixEolChars(range.text);
				var marker = "\x07";
				var markedRange = marker + fixedRange + marker;
				range.text = markedRange;
				var inputText = util.fixEolChars(inputArea.value);

				range.moveStart("character", -markedRange.length);
				range.text = fixedRange;

				stateObj.start = inputText.indexOf(marker);
				stateObj.end = inputText.lastIndexOf(marker) - marker.length;

				var len = stateObj.text.length - util.fixEolChars(inputArea.value).length;

				if (len) {
					range.moveStart("character", -fixedRange.length);
					while (len--) {
						fixedRange += "\n";
						stateObj.end += 1;
					}
					range.text = fixedRange;
				}

				if (panels.ieCachedRange)
					stateObj.scrollTop = panels.ieCachedScrollTop; // this is set alongside with ieCachedRange

				panels.ieCachedRange = null;

				this.setInputAreaSelection();
			}
		};

		// Restore this state into the input area.
		this.restore = function () {
			if (stateObj.text != undefined && stateObj.text != inputArea.value) {
				inputArea.value = stateObj.text;
			}
			this.setInputAreaSelection();
			inputArea.scrollTop = stateObj.scrollTop;
		};

		// Gets a collection of HTML chunks from the inptut textarea.
		this.getChunks = function () {
			var chunk = new Chunks();
			chunk.before = util.fixEolChars(stateObj.text.substring(0, stateObj.start));
			chunk.startTag = "";
			chunk.selection = util.fixEolChars(stateObj.text.substring(stateObj.start, stateObj.end));
			chunk.endTag = "";
			chunk.after = util.fixEolChars(stateObj.text.substring(stateObj.end));
			chunk.scrollTop = stateObj.scrollTop;

			return chunk;
		};

		// Sets the TextareaState properties given a chunk of markdown.
		this.setChunks = function (chunk) {

			chunk.before = chunk.before + chunk.startTag;
			chunk.after = chunk.endTag + chunk.after;

			this.start = chunk.before.length;
			this.end = chunk.before.length + (chunk.selection && chunk.selection.length || 0);
			this.text = chunk.before + chunk.selection + chunk.after;
			this.scrollTop = chunk.scrollTop;
		};
		this.init();
	}

	function UIManager() {

		var timer,
			inputBox = editor.panels.input,
			toolbar = editor.panels.toolbar;

		function getButton(t) {
			if (!t) return;

			if (t.nodeName === 'LI') {
				return t;
			}
			else {
				return getButton(t.parentNode);
			}
		}

		function hotkeyPressed(key, e) {
			e.preventDefault();
			e.stopPropagation();
			var t = getButton(toolbar.querySelector("li[data-key='" + key + "']"));

			if (t) {
				clickButton(t);
			}
		}

		function buttonClicked(e) {
			var t = getButton(e.target || e.srcElement);

			if (t) {
				editor.panels.toolbar.hide();
				clickButton(t);
			}
		}

		function clickButton(button) {
			editor.commandManager.doClick(button);

			if (window.event) {
				window.event.returnValue = false;
			}
		}

		util.addEvent(inputBox, "keypress", function (e) {
			var chr = e.key || e.keyCode && String.fromCharCode(e.keyCode);

			function done(left, right) {
				var prevent = editor.commandManager.doWrap(left, right);

				if (prevent) e.preventDefault();
			}

			switch (chr) {
				case "(":
					done('(', ')');
					break;
				case "\"":
					done('"', '"');
					break;
				case "'":
					done("'", "'");
					break;
				case "{":
					done("{", "}");
					break;
				case "[":
					done("[", "]");
					break;
				case "*":
					done("*", "*");
					break;
			}
		});

		util.addEvent(inputBox, uaSniffed.isOpera? "keypress": "keydown", function (e) {
			// Check to see if we have a button key and, if so execute the callback.
			if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {

				var keyCode = e.charCode || e.keyCode,
					keyCodeStr = String.fromCharCode(keyCode).toLowerCase();

				if (['b', 'i', 'l', 'q'].indexOf(keyCodeStr) !== -1) hotkeyPressed(keyCodeStr, e);
			}
		});

		// special handler because IE clears the context of the textbox on ESC
		if (uaSniffed.isIE) {
			util.addEvent(inputBox, "keydown", function (key) {
				var code = key.keyCode;
				if (code === 27) {
					return false;
				}
			});
		}

		// setup event listeners
		var el = toolbar.querySelectorAll('li');
		for (var i = 0; i < el.length; i++) el[i].addEventListener('click', buttonClicked);
	}

	function createCommandManager(pluginHooks) {
		var state;

		function CommandManager() {
			this.hooks = pluginHooks;
		}

		function initiate() {
			state = new TextareaState(editor.panels);

			if (state) {
				return state.getChunks();
			}
		}

		function finish(chunk) {
			editor.panels.input.focus();

			if (chunk) {
				state.setChunks(chunk);
			}

			state.restore();
			state = null;
			util.fireInputEvent();
		}

		var cp = CommandManager.prototype;

		// The markdown symbols - 4 spaces = code, > = blockquote, etc.
		cp.prefixes = "(?:\\s{4,}|\\s*>|\\s*-\\s+|\\s*\\d+\\.|=|\\+|-|_|\\*|#|\\s*\\[[^\n]]+\\]:)";

		// Remove markdown symbols from the chunk selection.
		cp.unwrap = function (chunk) {
			var txt = new re("([^\\n])\\n(?!(\\n|" + this.prefixes + "))", "g");
			chunk.selection = chunk.selection.replace(txt, "$1 $2");
		};

		cp.wrap = function (chunk, len) {
			this.unwrap(chunk);
			var regex = new re("(.{1," + len + "})( +|$\\n?)", "gm"),
				that = this;

			chunk.selection = chunk.selection.replace(regex, function (line, marked) {
				if (new re("^" + that.prefixes, "").test(line)) {
					return line;
				}
				return marked + "\n";
			});

			chunk.selection = chunk.selection.replace(/\s+$/, "");
		};

		// Perform the button's action.
		cp.doClick = function(button) {
			editor.panels.input.focus();
			var command = button.getAttribute('data-cmd');

			if (this[command]) {
				if (editor.undoManager) editor.undoManager.setCommandMode();
				this[command]();
			}
		};

		cp.bold = function () {
			return this.doWrap('**', '**', true);
		};

		cp.italic = function () {
			return this.doWrap('*', '*', true);
		};

		cp.doWrap = function (charsLeft, charsRight, toggle) {
			var howMany = charsLeft.length,
				charLeft = charsLeft.charAt(0),
				charRight = charsRight.charAt(0),
				before, after, prev,
				chunk = initiate();

			// Get rid of whitespace and fixup newlines.
			chunk.trimWhitespace();
			chunk.selection = chunk.selection.replace(/\n{2,}/g, "\n");

			if (chunk.selection) {
				// Look for stars before and after.  Is the chunk already marked up?
				// note that these regex matches cannot fail
				if (toggle) {
					before = new RegExp(util.escapeRegExp(charLeft) + "*$").exec(chunk.before)[0];
					after = new RegExp("^" + util.escapeRegExp(charRight) + "*").exec(chunk.after)[0];
					prev = Math.min(before.length, after.length);
				}

				// Remove stars if we have to since the button acts as a toggle.
				if (toggle && (prev >= howMany) && (prev != 2 || howMany != 1)) {
					chunk.before = chunk.before.replace(new re(util.escapeRegExp(charsLeft) + "$", ""), "");
					chunk.after = chunk.after.replace(new re("^" + util.escapeRegExp(charsRight), ""), "");
				}
				else {
					// Add the true markup.
					chunk.before = chunk.before + charsLeft;
					chunk.after = charsRight + chunk.after;
				}

				finish(chunk);
				return true;
			}
		};

		function stripLinkDefs(text, defsToAdd) {

			text = text.replace(/^[ ]{0,3}\[(\d+)\]:[ \t]*\n?[ \t]*<?(\S+?)>?[ \t]*\n?[ \t]*(?:(\n*)["(](.+?)[")][ \t]*)?(?:\n+|$)/gm,
				function (totalMatch, id, link, newlines, title) {
					defsToAdd[id] = totalMatch.replace(/\s*$/, "");
					if (newlines) {
						// Strip the title and return that separately.
						defsToAdd[id] = totalMatch.replace(/["(](.+?)[")]$/, "");
						return newlines + title;
					}
					return "";
				});

			return text;
		}

		function getLinkDef(chunk) {
			var r1 = /\]\[([\d])\]/,
				r2 = /\]\[([^\]]+)\]/,
				m1 = chunk.endTag.match(r1),
				m2 = chunk.endTag.match(r2),
				m, link = '';

			if (m1) {
				var r3 = new RegExp("\\[" + m1[1] + "\\]:\\s+(.+)");
				m = chunk.after.match(r3);

				if (m) {
					link = m[1];
				}
			}
			else if (m2) {
				link = m2[1];
			}

			return link;
		}

		function addLinkDef(chunk, linkDef) {
			var refNumber = 0; // The current reference number
			var defsToAdd = {}; //
			// Start with a clean slate by removing all previous link definitions.
			chunk.before = stripLinkDefs(chunk.before, defsToAdd);
			chunk.selection = stripLinkDefs(chunk.selection, defsToAdd);
			chunk.after = stripLinkDefs(chunk.after, defsToAdd);

			var defs = "";
			var regex = /(\[)((?:\[[^\]]*\]|[^\[\]])*)(\][ ]?(?:\n[ ]*)?\[)(\d+)(\])/g;

			function addDefNumber(def) {
				refNumber++;
				def = def.replace(/^[ ]{0,3}\[(\d+)\]:/, "  [" + refNumber + "]:");
				defs += "\n" + def;
			}

			// note that
			// a) the recursive call to getLink cannot go infinite, because by definition
			//    of regex, inner is always a proper substring of wholeMatch, and
			// b) more than one level of nesting is neither supported by the regex
			//    nor making a lot of sense (the only use case for nesting is a linked image)
			function getLink(wholeMatch, before, inner, afterInner, id, end) {
				inner = inner.replace(regex, getLink);
				if (defsToAdd[id]) {
					addDefNumber(defsToAdd[id]);
					return before + inner + afterInner + refNumber + end;
				}
				return wholeMatch;
			}

			chunk.before = chunk.before.replace(regex, getLink);

			if (linkDef) {
				addDefNumber(linkDef);
			}
			else {
				chunk.selection = chunk.selection.replace(regex, getLink);
			}

			var refOut = refNumber;
			chunk.after = chunk.after.replace(regex, getLink);

			if (chunk.after) {
				chunk.after = chunk.after.replace(/\n*$/, "");
			}

			if (!chunk.after) {
				chunk.selection = chunk.selection.replace(/\n*$/, "");
			}

			chunk.after += "\n\n" + defs;

			return refOut;
		}

		// takes the line as entered into the add link/as image dialog and makes
		// sure the URL and the optinal title are "nice".
		function properlyEncoded(linkdef) {
			return linkdef.replace(/^\s*(.*?)(?:\s+"(.+)")?\s*$/, function (wholematch, link, title) {
				
				var inQueryString = false;

				// The last alternative, `[^\w\d-./]`, is just a shortcut that lets us skip
				// the most common characters in URLs. Replacing it with `.` would not change
				// the result, because encodeURI returns those characters unchanged, but it
				// would mean lots of unnecessary replacement calls
				link = link.replace(/%(?:[\da-fA-F]{2})|\?|\+|[^\w\d-./]/g, function (match) {
					// Valid percent encoding. Could just return it as is, but we follow RFC3986
					// Section 2.1 which says "For consistency, URI producers and normalizers
					// should use uppercase hexadecimal digits for all percent-encodings."
					// Note that we also handle (illegal) stand-alone percent characters by
					// replacing them with "%25"
					if (match.length === 3 && match.charAt(0) == "%") {
						return match.toUpperCase();
					}
					switch (match) {
						case "?":
							inQueryString = true;
							return "?";
						
						// In the query string, a plus and a space are identical -- normalize.
						// Not strictly necessary, but identical behavior to the previous version
						// of this function.
						case "+":
							if (inQueryString)
								return "%20";
							break;
					}
					return encodeURI(match);
				});
				
				if (title) {
					title = title.trim ? title.trim() : title.replace(/^\s*/, "").replace(/\s*$/, "");
					title = title.replace(/"/g, "quot;").replace(/\(/g, "&#40;").replace(/\)/g, "&#41;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
				}
				return title ? link + ' "' + title + '"' : link;
			});
		}

		// The function to be executed when you enter a link and press OK or Cancel.
		// Marks up the link and adds the ref.
		function linkEnteredCallback(link, which, chunk) {
			if (link) {
				// Fixes common pasting errors.
				link = link.replace(/^http:\/\/(https?|ftp):\/\//, '$1://');
				if (!/^(?:https?|ftp):\/\//.test(link))
					link = 'http://' + link;

				// (                          $1
				//     [^\\]                  anything that's not a backslash
				//     (?:\\\\)*              an even number (this includes zero) of backslashes
				// )
				// (?=                        followed by
				//     [[\]]                  an opening or closing bracket
				// )
				//
				// In other words, a non-escaped bracket. These have to be escaped now to make sure they
				// don't count as the end of the link or similar.
				// Note that the actual bracket has to be a lookahead, because (in case of to subsequent brackets),
				// the bracket in one match may be the "not a backslash" character in the next match, so it
				// should not be consumed by the first match.
				// The "prepend a space and finally remove it" steps makes sure there is a "not a backslash" at the
				// start of the string, so this also works if the selection begins with a bracket. We cannot solve
				// this by anchoring with ^, because in the case that the selection starts with two brackets, this
				// would mean a zero-width match at the start. Since zero-width matches advance the string position,
				// the first bracket could then not act as the "not a backslash" for the second.
				chunk.selection = (" " + chunk.selection).replace(/([^\\](?:\\\\)*)(?=[[\]])/g, "$1\\").substr(1);
				
				var linkDef = " [999]: " + properlyEncoded(link),
					num = addLinkDef(chunk, linkDef);

				chunk.startTag = which === 'image' ? "![" : "[";
				chunk.endTag = "][" + num + "]";

				if (!chunk.selection) {
					if (which === 'image') {
						chunk.selection = editor.getString("imagedescription");
					}
					else {
						chunk.selection = editor.getString("linkdescription");
					}
				}
			}
			else if (link === '') {
				chunk.startTag = chunk.startTag.replace(/!?\[/, "");
				chunk.endTag = "";
				addLinkDef(chunk, null);
			}
			else {
				// null (cancel)
				// do nothing
			}

			finish(chunk);
		}

		cp.link = function () {
			linkOrImage('link');
		};

		cp.image = function (chunk, postProcessing) {
			linkOrImage('image');
		};

		function linkOrImage(which) {
			var chunk = initiate();

			chunk.trimWhitespace();
			chunk.findTags(/\s*!?\[/, /\][ ]?(?:\n[ ]*)?(\[.*?\])?/);

			// link found
			if (chunk.endTag.length > 1 && chunk.startTag.length > 0) {
				editor.panels.link(getLinkDef(chunk), function(link) { linkEnteredCallback(link, which, chunk); });
			}
			else {
				// We're moving start and end tag back into the selection, since (as we're in the else block) we're not
				// *removing* a link, but *adding* one, so whatever findTags() found is now back to being part of the
				// link text. linkEnteredCallback takes care of escaping any brackets.
				chunk.selection = chunk.startTag + chunk.selection + chunk.endTag;
				chunk.startTag = chunk.endTag = "";

				if (/\n\n/.test(chunk.selection)) {
					addLinkDef(chunk, null);
					return;
				}

				editor.panels.link('', function(link) { linkEnteredCallback(link, which, chunk); });
			}
		}

		cp.quote = function () {
			var chunk = initiate();

			chunk.selection = chunk.selection.replace(/^(\n*)([^\r]+?)(\n*)$/,
				function (totalMatch, newlinesBefore, text, newlinesAfter) {
					chunk.before += newlinesBefore;
					chunk.after = newlinesAfter + chunk.after;
					return text;
				});

			chunk.before = chunk.before.replace(/(>[ \t]*)$/,
				function (totalMatch, blankLine) {
					chunk.selection = blankLine + chunk.selection;
					return "";
				});

			chunk.selection = chunk.selection.replace(/^(\s|>)+$/, "");
			chunk.selection = chunk.selection || editor.getString("quoteexample");

			// The original code uses a regular expression to find out how much of the
			// text *directly before* the selection already was a blockquote:

			/*
			if (chunk.before) {
			chunk.before = chunk.before.replace(/\n?$/, "\n");
			}
			chunk.before = chunk.before.replace(/(((\n|^)(\n[ \t]*)*>(.+\n)*.*)+(\n[ \t]*)*$)/,
			function (totalMatch) {
			chunk.startTag = totalMatch;
			return "";
			});
			*/

			// This comes down to:
			// Go backwards as many lines a possible, such that each line
			//  a) starts with ">", or
			//  b) is almost empty, except for whitespace, or
			//  c) is preceeded by an unbroken chain of non-empty lines
			//     leading up to a line that starts with ">" and at least one more character
			// and in addition
			//  d) at least one line fulfills a)
			//
			// Since this is essentially a backwards-moving regex, it's susceptible to
			// catstrophic backtracking and can cause the browser to hang;
			// see e.g. http://meta.stackexchange.com/questions/9807.
			//
			// Hence we replaced this by a simple state machine that just goes through the
			// lines and checks for a), b), and c).

			var match = "",
				leftOver = "",
				line;
			if (chunk.before) {
				var lines = chunk.before.replace(/\n$/, "").split("\n");
				var inChain = false;
				for (var i = 0; i < lines.length; i++) {
					var good = false;
					line = lines[i];
					inChain = inChain && line.length > 0; // c) any non-empty line continues the chain
					if (/^>/.test(line)) {                // a)
						good = true;
						if (!inChain && line.length > 1)  // c) any line that starts with ">" and has at least one more character starts the chain
							inChain = true;
					} else if (/^[ \t]*$/.test(line)) {   // b)
						good = true;
					} else {
						good = inChain;                   // c) the line is not empty and does not start with ">", so it matches if and only if we're in the chain
					}
					if (good) {
						match += line + "\n";
					} else {
						leftOver += match + line;
						match = "\n";
					}
				}
				if (!/(^|\n)>/.test(match)) {             // d)
					leftOver += match;
					match = "";
				}
			}

			chunk.startTag = match;
			chunk.before = leftOver;

			// end of change

			if (chunk.after) {
				chunk.after = chunk.after.replace(/^\n?/, "\n");
			}

			chunk.after = chunk.after.replace(/^(((\n|^)(\n[ \t]*)*>(.+\n)*.*)+(\n[ \t]*)*)/,
				function (totalMatch) {
					chunk.endTag = totalMatch;
					return "";
				}
			);

			var replaceBlanksInTags = function (useBracket) {

				var replacement = useBracket ? "> " : "";

				if (chunk.startTag) {
					chunk.startTag = chunk.startTag.replace(/\n((>|\s)*)\n$/,
						function (totalMatch, markdown) {
							return "\n" + markdown.replace(/^[ ]{0,3}>?[ \t]*$/gm, replacement) + "\n";
						});
				}
				if (chunk.endTag) {
					chunk.endTag = chunk.endTag.replace(/^\n((>|\s)*)\n/,
						function (totalMatch, markdown) {
							return "\n" + markdown.replace(/^[ ]{0,3}>?[ \t]*$/gm, replacement) + "\n";
						});
				}
			};

			if (/^(?![ ]{0,3}>)/m.test(chunk.selection)) {
				this.wrap(chunk, SETTINGS.lineLength - 2);
				chunk.selection = chunk.selection.replace(/^/gm, "> ");
				replaceBlanksInTags(true);
				chunk.skipLines();
			} else {
				chunk.selection = chunk.selection.replace(/^[ ]{0,3}> ?/gm, "");
				this.unwrap(chunk);
				replaceBlanksInTags(false);

				if (!/^(\n|^)[ ]{0,3}>/.test(chunk.selection) && chunk.startTag) {
					chunk.startTag = chunk.startTag.replace(/\n{0,2}$/, "\n\n");
				}

				if (!/(\n|^)[ ]{0,3}>.*$/.test(chunk.selection) && chunk.endTag) {
					chunk.endTag = chunk.endTag.replace(/^\n{0,2}/, "\n\n");
				}
			}

			chunk.selection = this.hooks.postBlockquoteCreation(chunk.selection);

			if (!/\n/.test(chunk.selection)) {
				chunk.selection = chunk.selection.replace(/^(> *)/,
				function (wholeMatch, blanks) {
					chunk.startTag += blanks;
					return "";
				});
			}

			finish(chunk);
		};

		cp.code = function () {
			var self = this, chunk = initiate();
			var hasTextBefore = /\S[ ]*$/.test(chunk.before);
			var hasTextAfter = /^[ ]*\S/.test(chunk.after);

			// Use 'four space' markdown if the selection is on its own
			// line or is multiline.
			if ((!hasTextAfter && !hasTextBefore) || /\n/.test(chunk.selection)) {

				chunk.before = chunk.before.replace(/[ ]{4}$/,
					function (totalMatch) {
						chunk.selection = totalMatch + chunk.selection;
						return "";
					});

				var nLinesBack = 1;
				var nLinesForward = 1;

				if (/(\n|^)(\t|[ ]{4,}).*\n$/.test(chunk.before)) {
					nLinesBack = 0;
				}
				if (/^\n(\t|[ ]{4,})/.test(chunk.after)) {
					nLinesForward = 0;
				}

				chunk.skipLines(nLinesBack, nLinesForward);

				if (!chunk.selection) {
					chunk.startTag = "    ";
					chunk.selection = editor.getString("codeexample");
				}
				else {
					if (/^[ ]{0,3}\S/m.test(chunk.selection)) {
						if (/\n/.test(chunk.selection))
							chunk.selection = chunk.selection.replace(/^/gm, "    ");
						else // if it's not multiline, do not select the four added spaces; this is more consistent with the doList behavior
							chunk.before += "    ";
					}
					else {
						chunk.selection = chunk.selection.replace(/^(?:[ ]{4}|[ ]{0,3}\t)/gm, "");
					}
				}
			}
			else {
				// Use backticks (`) to delimit the code block.

				chunk.trimWhitespace();
				chunk.findTags(/`/, /`/);

				if (!chunk.startTag && !chunk.endTag) {
					chunk.startTag = chunk.endTag = "`";
					if (!chunk.selection) {
						chunk.selection = editor.getString("codeexample");
					}
				}
				else if (chunk.endTag && !chunk.startTag) {
					chunk.before += chunk.endTag;
					chunk.endTag = "";
				}
				else {
					chunk.startTag = chunk.endTag = "";
				}
			}

			finish(chunk);
		};

		return new CommandManager();
	}

})(Markdown);

module.exports = Markdown.Editor;
