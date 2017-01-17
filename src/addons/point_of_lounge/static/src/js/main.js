odoo.define('point_of_lounge.main', function (require) {
	"use strict";
	var chrome = require('point_of_lounge.chrome');
	var core = require('web.core');
	core.action_registry.add('lounge.ui', chrome.Chrome);
});
