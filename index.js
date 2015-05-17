module.exports = DerbyPageDown;

function DerbyPageDown() {}

DerbyPageDown.prototype.view = __dirname;

DerbyPageDown.prototype.init = function(model) {
	// to prevent any 'undefined' texts from appearing
	model.setNull('text', '');
};

DerbyPageDown.prototype.create = function(model) {
	var self = this;
	Editor = require("./src/js/Markdown.Editor");
	editor = this.editor = new Editor(this);
	editor.run();
	this.expandingArea.className += " active";

	model.on('change', model.at('autofocus'), function(val) {
		if (val) {
			self.input.focus();
		}
	});
};

DerbyPageDown.prototype.focus = function(ev, el) {
	this.model.del('autofocus');
};

DerbyPageDown.prototype.emitKeydown = function(ev, el) {
	this.emit("keydown", ev, el);
};

DerbyPageDown.prototype.toolbar = function(which) {
	var t = this.model.get('toolbar');
	return !t || t.indexOf(which) !== -1;
};

