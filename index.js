module.exports = DerbyPageDown;

function DerbyPageDown() {}

DerbyPageDown.prototype.view = __dirname;

DerbyPageDown.prototype.init = function(model) {
	// to prevent any 'undefined' texts from appearing
	model.setNull('text', '');
};

DerbyPageDown.prototype.create = function(model) {
	Editor = require("./Markdown.Editor");
	editor = this.editor = new Editor(this);
	editor.run();
	this.expandingArea.className += " active";
};

DerbyPageDown.prototype.emitKeydown = function(ev, el) {
	this.emit("keydown", ev, el);
};

