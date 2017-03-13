odoo.define('point_of_lounge.screens', function (require) {
	"use strict";

	var PosBaseWidget = require('point_of_lounge.BaseWidget');
	var gui = require('point_of_lounge.gui');
	var models = require('point_of_lounge.models');
	var core = require('web.core');
	var Model = require('web.DataModel');
	var utils = require('web.utils');
	var formats = require('web.formats');

	var QWeb = core.qweb;
	var _t = core._t;
	var round_pr = utils.round_precision;

	/*--------------------------------------*\
	 |          THE SCREEN WIDGET           |
	\*======================================*/
	// The screen widget is the base class inherited
	// by all screens.
	var ScreenWidget = PosBaseWidget.extend({

	    init: function(parent,options){
	        this._super(parent,options);
	        this.hidden = false;
	    },

	    barcode_product_screen:'products',     //if defined, this screen will be loaded when a product is scanned

	    // what happens when a product is scanned :
	    // it will add the product to the order and go to barcode_product_screen.
	    barcode_product_action: function(code){
	        var self = this;
	        if (self.lounge.scan_product(code)) {
	            if (self.barcode_product_screen) {
	                self.gui.show_screen(self.barcode_product_screen);
	            }
	        } else {
	            this.barcode_error_action(code);
	        }
	    },

	    // what happens when a cashier id barcode is scanned.
	    // the default behavior is the following :
	    // - if there's a user with a matching barcode, put it as the active 'cashier', go to cashier mode, and return true
	    // - else : do nothing and return false. You probably want to extend this to show and appropriate error popup...
	    barcode_cashier_action: function(code){
	        var users = this.lounge.users;
	        for(var i = 0, len = users.length; i < len; i++){
	            if(users[i].barcode === code.code){
	                this.lounge.set_cashier(users[i]);
	                this.chrome.widget.username.renderElement();
	                return true;
	            }
	        }
	        this.barcode_error_action(code);
	        return false;
	    },

	    // what happens when a client id barcode is scanned.
	    // the default behavior is the following :
	    // - if there's a user with a matching barcode, put it as the active 'client' and return true
	    // - else : return false.
	    barcode_client_action: function(code){
	        var partner = this.lounge.db.get_partner_by_barcode(code.code);
	        if(partner){
	            this.lounge.get_order().set_client(partner);
	            return true;
	        }
	        this.barcode_error_action(code);
	        return false;
	    },

	    // what happens when a discount barcode is scanned : the default behavior
	    // is to set the discount on the last order.
	    barcode_discount_action: function(code){
	        var last_orderline = this.lounge.get_order().get_last_orderline();
	        if(last_orderline){
	            last_orderline.set_discount(code.value);
	        }
	    },
	    // What happens when an invalid barcode is scanned : shows an error popup.
	    barcode_error_action: function(code) {
	        var show_code;
	        if (code.code.length > 32) {
	            show_code = code.code.substring(0,29)+'...';
	        } else {
	            show_code = code.code;
	        }
	        this.gui.show_popup('error-barcode',show_code);
	    },

	    // this method shows the screen and sets up all the widget related to this screen. Extend this method
	    // if you want to alter the behavior of the screen.
	    show: function(){
	        var self = this;

	        this.hidden = false;
	        if(this.$el){
	            this.$el.removeClass('oe_hidden');
	        }

	        this.lounge.barcode_reader.set_action_callback({
	            'cashier': _.bind(self.barcode_cashier_action, self),
	            'product': _.bind(self.barcode_product_action, self),
	            'weight': _.bind(self.barcode_product_action, self),
	            'price': _.bind(self.barcode_product_action, self),
	            'client' : _.bind(self.barcode_client_action, self),
	            'discount': _.bind(self.barcode_discount_action, self),
	            'error'   : _.bind(self.barcode_error_action, self),
	        });
	    },

	    // this method is called when the screen is closed to make place for a new screen. this is a good place
	    // to put your cleanup stuff as it is guaranteed that for each show() there is one and only one close()
	    close: function(){
	        if(this.lounge.barcode_reader){
	            this.lounge.barcode_reader.reset_action_callbacks();
	        }
	    },

	    // this methods hides the screen. It's not a good place to put your cleanup stuff as it is called on the
	    // POS initialization.
	    hide: function(){
	        this.hidden = true;
	        if(this.$el){
	            this.$el.addClass('oe_hidden');
	        }
	    },

	    // we need this because some screens re-render themselves when they are hidden
	    // (due to some events, or magic, or both...)  we must make sure they remain hidden.
	    // the good solution would probably be to make them not re-render themselves when they
	    // are hidden.
	    renderElement: function(){
	        this._super();
	        if(this.hidden){
	            if(this.$el){
	                this.$el.addClass('oe_hidden');
	            }
	        }
	    },
	});

	/*--------------------------------------*\
	 |          THE DOM CACHE               |
	\*======================================*/

	// The Dom Cache is used by various screens to improve
	// their performances when displaying many time the
	// same piece of DOM.
	//
	// It is a simple map from string 'keys' to DOM Nodes.
	//
	// The cache empties itself based on usage frequency
	// stats, so you may not always get back what
	// you put in.

	var DomCache = core.Class.extend({
	    init: function(options){
	        options = options || {};
	        this.max_size = options.max_size || 2000;

	        this.cache = {};
	        this.access_time = {};
	        this.size = 0;
	    },
	    cache_node: function(key,node){
	        var cached = this.cache[key];
	        this.cache[key] = node;
	        this.access_time[key] = new Date().getTime();
	        if(!cached){
	            this.size++;
	            while(this.size >= this.max_size){
	                var oldest_key = null;
	                var oldest_time = new Date().getTime();
	                for(key in this.cache){
	                    var time = this.access_time[key];
	                    if(time <= oldest_time){
	                        oldest_time = time;
	                        oldest_key  = key;
	                    }
	                }
	                if(oldest_key){
	                    delete this.cache[oldest_key];
	                    delete this.access_time[oldest_key];
	                }
	                this.size--;
	            }
	        }
	        return node;
	    },
	    clear_node: function(key) {
	        var cached = this.cache[key];
	        if (cached) {
	            delete this.cache[key];
	            delete this.access_time[key];
	            this.size --;
	        }
	    },
	    get_node: function(key){
	        var cached = this.cache[key];
	        if(cached){
	            this.access_time[key] = new Date().getTime();
	        }
	        return cached;
	    },
	});

	/*--------------------------------------*\
	 |          THE SCALE SCREEN            |
	\*======================================*/

	// The scale screen displays the weight of
	// a product on the electronic scale.

	var ScaleScreenWidget = ScreenWidget.extend({
	    template:'LoungeScaleScreenWidget',

	    next_screen: 'products',
	    previous_screen: 'products',

	    show: function(){
	        this._super();
	        var self = this;
	        var queue = this.lounge.proxy_queue;

	        this.set_weight(0);
	        this.renderElement();

	        this.hotkey_handler = function(event){
	            if(event.which === 13){
	                self.order_product();
	                self.gui.show_screen(self.next_screen);
	            }else if(event.which === 27){
	                self.gui.show_screen(self.previous_screen);
	            }
	        };

	        $('body').on('keypress',this.hotkey_handler);

	        this.$('.back').click(function(){
	            self.gui.show_screen(self.previous_screen);
	        });

	        this.$('.next,.buy-product').click(function(){
	            self.order_product();
	            self.gui.show_screen(self.next_screen);
	        });

	        queue.schedule(function(){
	            return self.lounge.proxy.scale_read().then(function(weight){
	                self.set_weight(weight.weight);
	            });
	        },{duration:50, repeat: true});

	    },
	    get_product: function(){
	        return this.gui.get_current_screen_param('product');
	    },
	    order_product: function(){
	        this.lounge.get_order().add_product(this.get_product(),{ quantity: this.weight });
	    },
	    get_product_name: function(){
	        var product = this.get_product();
	        return (product ? product.display_name : undefined) || 'Unnamed Product';
	    },
	    get_product_price: function(){
	        var product = this.get_product();
	        return (product ? product.price : 0) || 0;
	    },
	    get_product_uom: function(){
	        var product = this.get_product();

	        if(product){
	            return this.lounge.units_by_id[product.uom_id[0]].name;
	        }else{
	            return '';
	        }
	    },
	    set_weight: function(weight){
	        this.weight = weight;
	        this.$('.weight').text(this.get_product_weight_string());
	        this.$('.computed-price').text(this.get_computed_price_string());
	    },
	    get_product_weight_string: function(){
	        var product = this.get_product();
	        var defaultstr = (this.weight || 0).toFixed(3) + ' Kg';
	        if(!product || !this.lounge){
	            return defaultstr;
	        }
	        var unit_id = product.uom_id;
	        if(!unit_id){
	            return defaultstr;
	        }
	        var unit = this.lounge.units_by_id[unit_id[0]];
	        var weight = round_pr(this.weight || 0, unit.rounding);
	        var weightstr = weight.toFixed(Math.ceil(Math.log(1.0/unit.rounding) / Math.log(10) ));
	        weightstr += ' ' + unit.name;
	        return weightstr;
	    },
	    get_computed_price_string: function(){
	        return this.format_currency(this.get_product_price() * this.weight);
	    },
	    close: function(){
	        this._super();
	        $('body').off('keypress',this.hotkey_handler);

	        this.lounge.proxy_queue.clear();
	    },
	});
	gui.define_screen({name: 'scale', widget: ScaleScreenWidget});

	/*--------------------------------------*\
	 |         THE PRODUCT SCREEN           |
	\*======================================*/

	// The product screen contains the list of products,
	// The category selector and the order display.
	// It is the default screen for orders and the
	// startup screen for shops.
	//
	// There product screens uses many sub-widgets,
	// the code follows.


	/* ------------ The Numpad ------------ */

	// The numpad that edits the order lines.

	var NumpadWidget = PosBaseWidget.extend({
	    template:'LoungeNumpadWidget',
	    init: function(parent) {
	        this._super(parent);
	        this.state = new models.NumpadState();
	    },
	    start: function() {
	        this.state.bind('change:mode', this.changedMode, this);
	        this.changedMode();
	        this.$el.find('.numpad-backspace').click(_.bind(this.clickDeleteLastChar, this));
	        this.$el.find('.numpad-minus').click(_.bind(this.clickSwitchSign, this));
	        this.$el.find('.number-char').click(_.bind(this.clickAppendNewChar, this));
	        this.$el.find('.mode-button').click(_.bind(this.clickChangeMode, this));
	    },
	    clickDeleteLastChar: function() {
	        return this.state.deleteLastChar();
	    },
	    clickSwitchSign: function() {
	        return this.state.switchSign();
	    },
	    clickAppendNewChar: function(event) {
	        var newChar;
	        newChar = event.currentTarget.innerText || event.currentTarget.textContent;
	        return this.state.appendNewChar(newChar);
	    },
	    clickChangeMode: function(event) {
	        var newMode = event.currentTarget.attributes['data-mode'].nodeValue;
	        return this.state.changeMode(newMode);
	    },
	    changedMode: function() {
	        var mode = this.state.get('mode');
	        $('.selected-mode').removeClass('selected-mode');
	        $(_.str.sprintf('.mode-button[data-mode="%s"]', mode), this.$el).addClass('selected-mode');
	    },
	});

	/* ---------- The Action Flight ---------- */
	var ActionflightWidget = PosBaseWidget.extend({
        template: 'LoungeActionflightWidget',
        init: function(parent, options){
            var self = this;
	        this._super(parent, options);
	        self.renderElement();
	    },
	    renderElement: function() {
            var self = this;
            this._super();

            this.$('#flight_type').change(function(){
                var flight_type = $(this).val();
                self.lounge.get_order().set_flight_type(flight_type);
            });

            this.$('#flight_number').change(function(){
                var flight_number = $(this).val();
                self.lounge.get_order().set_flight_number(flight_number);
            });
        },

	});
	//gui.define_screen({name:'flight', widget:ActionflightWidget});

	/* ---------- The Action Time ---------- */
	var ActiontimeWidget = PosBaseWidget.extend({
	    template: "LoungeActiontimeWidget",
	    events: {
            'blur .booking_from_date': 'booking_from_date_changed',
            'blur .booking_to_date': 'booking_to_date_changed'
        },
	    init: function(parent) {
            this._super(parent);
            this.time_changed();
        },
	    start: function() {
            this.renderComponent();
        },
        show:function() {
			this._super(parent);

			this.time_changed();
        },
        renderComponent:function() {
	        this.$('.timepicker').datetimepicker({
	            //minView: 2,
	            useCurrent: true,
	            pickDate: true,
	            format: 'DD/MM/YYYY HH:mm',
	            use24hours: true
	        });
		},
        booking_from_date_changed: function() {
            var val = this.$('.booking_from_date').val();
            this.lounge.get_order().set_booking_from_date(val);
        },
        booking_to_date_changed: function() {
            var val = this.$('.booking_to_date').val();
            this.lounge.get_order().set_booking_to_date(val);
        },
        time_changed: function() {
	        var booking_from_date = this.lounge.get_booking_from_date();
	        var booking_to_date = this.lounge.get_booking_to_date();
	        this.$('.booking_from_date').val(booking_from_date ? booking_from_date : _t('') );
	        this.$('.booking_to_date').val(booking_to_date ? booking_to_date : _t('') );
	        //this.$('.js_booking_from_date').text( booking_from_date ? booking_from_date : _t('None') );
	        //this.$('.js_booking_to_date').text( booking_to_date ? booking_to_date : _t('None') );
	    },

	});
	/* ---------- The Action Time  ---------- */

	// The action pad contains the payment button and the
	// customer selection button

	var ActioncheckoutWidget = PosBaseWidget.extend({
	    template: 'LoungeActioncheckoutWidget',
	    init: function(parent, options) {
            var self = this;
            this._super(parent, options);
            this.lounge.bind('change:selectedClient', function() {
                self.renderElement();
            });
	    },
	    renderElement: function() {
	        var self = this;
            this._super();

            this.$('.set-order').click(function(){
                self.gui.show_screen('orderlist');
            });
	    }
	});

	// The action pad contains the payment button and the
	// customer selection button

	var ActionpadWidget = PosBaseWidget.extend({
	    template: 'LoungeActionpadWidget',
        init: function(parent, options) {
            var self = this;
            this._super(parent, options);


            this.lounge.bind('change:selectedClient', function() {
                self.renderElement();
            });
        },
        renderElement: function() {
            var self = this;
            this._super();

            this.$('.pay').click(function(){
                var booking_from_date = self.lounge.get_booking_from_date();
                var booking_to_date = self.lounge.get_booking_to_date();

                if(!booking_from_date) {
                     self.gui.show_popup('error',{
	                    'title': _t('Error: Field'),
	                    'body': _t('Time from is required.'),
	                });
	                return;
                }

                if(!booking_to_date) {
                     self.gui.show_popup('error',{
	                    'title': _t('Error: Field'),
	                    'body': _t('Time To is required.'),
	                });
	                return;
                }

				if(booking_from_date && booking_to_date) {
                    self.gui.show_screen('payment');
                }
            });
            this.$('.set-customer').click(function(){
                self.gui.show_screen('clientlist');
            });
        }
	});

	/* --------- The Order Widget --------- */

	// Displays the current Order.

	var OrderWidget = PosBaseWidget.extend({
	    template:'LoungeOrderWidget',
	    init: function(parent, options) {
	        var self = this;
	        this._super(parent,options);

	        this.numpad_state = options.numpad_state;
	        this.numpad_state.reset();
	        this.numpad_state.bind('set_value',   this.set_value, this);

	        this.lounge.bind('change:selectedOrder', this.change_selected_order, this);

	        this.line_click_handler = function(event){
	            self.click_line(this.orderline, event);
	        };

	        if (this.lounge.get_order()) {
	            this.bind_order_events();
	        }

	    },
	    click_line: function(orderline, event) {
	        this.lounge.get_order().select_orderline(orderline);
	        this.numpad_state.reset();
	    },
	    set_value: function(val) {
	        var order = this.lounge.get_order();
	        if (order.get_selected_orderline()) {
	            var mode = this.numpad_state.get('mode');
	            if( mode === 'quantity'){
	                order.get_selected_orderline().set_quantity(val);
	            }else if( mode === 'discount'){
	                order.get_selected_orderline().set_discount(val);
	            }else if( mode === 'price'){
	                order.get_selected_orderline().set_unit_price(val);
	            }
	        }
	    },
	    change_selected_order: function() {
	        if (this.lounge.get_order()) {
	            this.bind_order_events();
	            this.numpad_state.reset();
	            this.renderElement();
	        }
	    },
	    orderline_add: function(){
	        this.numpad_state.reset();
	        this.renderElement('and_scroll_to_bottom');
	    },
	    orderline_remove: function(line){
	        this.remove_orderline(line);
	        this.numpad_state.reset();
	        this.update_summary();
	    },
	    orderline_change: function(line){
	        this.rerender_orderline(line);
	        this.update_summary();
	    },
	    bind_order_events: function() {
	        var order = this.lounge.get_order();
	            order.unbind('change:client', this.update_summary, this);
	            order.bind('change:client',   this.update_summary, this);
	            order.unbind('change',        this.update_summary, this);
	            order.bind('change',          this.update_summary, this);

	        var lines = order.orderlines;
	            lines.unbind('add',     this.orderline_add,    this);
	            lines.bind('add',       this.orderline_add,    this);
	            lines.unbind('remove',  this.orderline_remove, this);
	            lines.bind('remove',    this.orderline_remove, this);
	            lines.unbind('change',  this.orderline_change, this);
	            lines.bind('change',    this.orderline_change, this);

	    },
	    render_orderline: function(orderline){
	        var el_str  = QWeb.render('LoungeOrderline',{widget:this, line:orderline});
	        var el_node = document.createElement('div');
	            el_node.innerHTML = _.str.trim(el_str);
	            el_node = el_node.childNodes[0];
	            el_node.orderline = orderline;
	            el_node.addEventListener('click',this.line_click_handler);

	        orderline.node = el_node;
	        return el_node;
	    },
	    remove_orderline: function(order_line){
	        if(this.lounge.get_order().get_orderlines().length === 0){
	            this.renderElement();
	        }else{
	            order_line.node.parentNode.removeChild(order_line.node);
	        }
	    },
	    rerender_orderline: function(order_line){
	        var node = order_line.node;
	        var replacement_line = this.render_orderline(order_line);
	        node.parentNode.replaceChild(replacement_line,node);
	    },
	    // overriding the openerp framework replace method for performance reasons
	    replace: function($target){
	        this.renderElement();
	        var target = $target[0];
	        target.parentNode.replaceChild(this.el,target);
	    },
	    renderElement: function(scrollbottom){
	        var order  = this.lounge.get_order();
	        if (!order) {
	            return;
	        }
	        var orderlines = order.get_orderlines();

	        var el_str  = QWeb.render('LoungeOrderWidget',{widget:this, order:order, orderlines:orderlines});

	        var el_node = document.createElement('div');
	            el_node.innerHTML = _.str.trim(el_str);
	            el_node = el_node.childNodes[0];

	        var list_container = el_node.querySelector('.orderlines');
	        for(var i = 0, len = orderlines.length; i < len; i++){
	            var orderline = this.render_orderline(orderlines[i]);
	            list_container.appendChild(orderline);
	        }

	        if(this.el && this.el.parentNode){
	            this.el.parentNode.replaceChild(el_node,this.el);
	        }
	        this.el = el_node;
	        this.update_summary();

	        if(scrollbottom){
	            this.el.querySelector('.order-scroller').scrollTop = 100 * orderlines.length;
	        }
	    },
	    update_summary: function(){
	        var order = this.lounge.get_order();
	        if (!order.get_orderlines().length) {
	            return;
	        }

	        var total     = order ? order.get_total_with_tax() : 0;
	        var taxes     = order ? total - order.get_total_without_tax() : 0;
	        var surcharge = order ? total - order.get_total_surcharge() : 0;

	        this.el.querySelector('.summary .total > .value').textContent = this.format_currency(total);
	        this.el.querySelector('.summary .total .subentry .value').textContent = this.format_currency(taxes);
	        this.el.querySelector('.summary .total .surcharge .value').textContent = this.format_currency(surcharge);
	    },
	});

	/* ------ The Product Categories ------ */

	// Display and navigate the product categories.
	// Also handles searches.
	//  - set_category() to change the displayed category
	//  - reset_category() to go to the root category
	//  - perform_search() to search for products
	//  - clear_search()   does what it says.

	var ProductCategoriesWidget = PosBaseWidget.extend({
	    template: 'LoungeProductCategoriesWidget',
	    init: function(parent, options){
	        var self = this;
	        this._super(parent,options);
	        this.product_type = options.product_type || 'all';  // 'all' | 'weightable'
	        this.onlyWeightable = options.onlyWeightable || false;
	        this.category = this.lounge.root_category;
	        this.breadcrumb = [];
	        this.subcategories = [];
	        this.product_list_widget = options.product_list_widget || null;
	        this.category_cache = new DomCache();
	        this.start_categ_id = this.lounge.config.iface_start_categ_id ? this.lounge.config.iface_start_categ_id[0] : 0;
	        this.set_category(this.lounge.db.get_category_by_id(this.start_categ_id));

	        this.switch_category_handler = function(event){
	            self.set_category(self.lounge.db.get_category_by_id(Number(this.dataset.categoryId)));
	            self.renderElement();
	        };

	        this.clear_search_handler = function(event){
	            self.clear_search();
	        };

	        var search_timeout  = null;
	        this.search_handler = function(event){
	            if(event.type == "keypress" || event.keyCode === 46 || event.keyCode === 8){
	                clearTimeout(search_timeout);

	                var searchbox = this;

	                search_timeout = setTimeout(function(){
	                    self.perform_search(self.category, searchbox.value, event.which === 13);
	                },70);
	            }
	        };
	    },

	    // changes the category. if undefined, sets to root category
	    set_category : function(category){
	        var db = this.lounge.db;
	        if(!category){
	            this.category = db.get_category_by_id(db.root_category_id);
	        }else{
	            this.category = category;
	        }
	        this.breadcrumb = [];
	        var ancestors_ids = db.get_category_ancestors_ids(this.category.id);
	        for(var i = 1; i < ancestors_ids.length; i++){
	            this.breadcrumb.push(db.get_category_by_id(ancestors_ids[i]));
	        }
	        if(this.category.id !== db.root_category_id){
	            this.breadcrumb.push(this.category);
	        }
	        this.subcategories = db.get_category_by_id(db.get_category_childs_ids(this.category.id));
	    },

	    get_image_url: function(category){
	        return window.location.origin + '/web/image?model=lounge.category&field=image_medium&id='+category.id;
	    },

	    render_category: function( category, with_image ){
	        var cached = this.category_cache.get_node(category.id);
	        if(!cached){
	            if(with_image){
	                var image_url = this.get_image_url(category);
	                var category_html = QWeb.render('LoungeCategoryButton',{
	                        widget:  this,
	                        category: category,
	                        image_url: this.get_image_url(category),
	                    });
	                    category_html = _.str.trim(category_html);
	                var category_node = document.createElement('div');
	                    category_node.innerHTML = category_html;
	                    category_node = category_node.childNodes[0];
	            }else{
	                var category_html = QWeb.render('LoungeCategorySimpleButton',{
	                        widget:  this,
	                        category: category,
	                    });
	                    category_html = _.str.trim(category_html);
	                var category_node = document.createElement('div');
	                    category_node.innerHTML = category_html;
	                    category_node = category_node.childNodes[0];
	            }
	            this.category_cache.cache_node(category.id,category_node);
	            return category_node;
	        }
	        return cached;
	    },

	    replace: function($target){
	        this.renderElement();
	        var target = $target[0];
	        target.parentNode.replaceChild(this.el,target);
	    },

	    renderElement: function(){

	        var el_str  = QWeb.render(this.template, {widget: this});
	        var el_node = document.createElement('div');

	        el_node.innerHTML = el_str;
	        el_node = el_node.childNodes[1];

	        if(this.el && this.el.parentNode){
	            this.el.parentNode.replaceChild(el_node,this.el);
	        }

	        this.el = el_node;

	        var withpics = this.lounge.config.iface_display_categ_images;

	        var list_container = el_node.querySelector('.category-list');
	        if (list_container) {
	            if (!withpics) {
	                list_container.classList.add('simple');
	            } else {
	                list_container.classList.remove('simple');
	            }
	            for(var i = 0, len = this.subcategories.length; i < len; i++){
	                list_container.appendChild(this.render_category(this.subcategories[i],withpics));
	            }
	        }

	        var buttons = el_node.querySelectorAll('.js-category-switch');
	        for(var i = 0; i < buttons.length; i++){
	            buttons[i].addEventListener('click',this.switch_category_handler);
	        }

	        var products = this.lounge.db.get_product_by_category(this.category.id);
	        this.product_list_widget.set_product_list(products); // FIXME: this should be moved elsewhere ...

	        this.el.querySelector('.searchbox input').addEventListener('keypress',this.search_handler);

	        this.el.querySelector('.searchbox input').addEventListener('keydown',this.search_handler);

	        this.el.querySelector('.search-clear').addEventListener('click',this.clear_search_handler);

	        if(this.lounge.config.iface_vkeyboard && this.chrome.widget.keyboard){
	            this.chrome.widget.keyboard.connect($(this.el.querySelector('.searchbox input')));
	        }
	    },

	    // resets the current category to the root category
	    reset_category: function(){
	        this.set_category(this.lounge.db.get_category_by_id(this.start_categ_id));
	        this.renderElement();
	    },

	    // empties the content of the search box
	    clear_search: function(){
	        var products = this.lounge.db.get_product_by_category(this.category.id);
	        this.product_list_widget.set_product_list(products);
	        var input = this.el.querySelector('.searchbox input');
	            input.value = '';
	            input.focus();
	    },
	    perform_search: function(category, query, buy_result){
	        var products;
	        if(query){
	            products = this.lounge.db.search_product_in_category(category.id,query);
	            if(buy_result && products.length === 1){
	                    this.lounge.get_order().add_product(products[0]);
	                    this.clear_search();
	            }else{
	                this.product_list_widget.set_product_list(products);
	            }
	        }else{
	            products = this.lounge.db.get_product_by_category(this.category.id);
	            this.product_list_widget.set_product_list(products);
	        }
	    },

	});

	/* --------- The Product List --------- */

	// Display the list of products.
	// - change the list with .set_product_list()
	// - click_product_action(), passed as an option, tells
	//   what to do when a product is clicked.

	var ProductListWidget = PosBaseWidget.extend({
	    template:'LoungeProductListWidget',
	    init: function(parent, options) {
	        var self = this;
	        this._super(parent,options);
	        this.model = options.model;
	        this.productwidgets = [];
	        this.weight = options.weight || 0;
	        this.show_scale = options.show_scale || false;
	        this.next_screen = options.next_screen || false;

	        this.click_product_handler = function(){
	            if(self.lounge.get_order().get_client()) {
	                var product = self.lounge.db.get_product_by_id(this.dataset.productId);
	                options.click_product_action(product);
	            } else {
	                self.gui.show_popup('error',{
	                    'title': _t('error'),
	                    'body': _t('A Customer Is Required.'),
	                });

	                return;
	            }
	        };

	        this.product_list = options.product_list || [];
	        this.product_cache = new DomCache();
	    },
	    set_product_list: function(product_list){
	        this.product_list = product_list;
	        this.renderElement();
	    },
	    get_product_image_url: function(product){
	        return window.location.origin + '/web/image?model=product.product&field=image&id='+product.id;
	    },
	    replace: function($target){
	        this.renderElement();
	        var target = $target[0];
	        target.parentNode.replaceChild(this.el,target);
	    },

	    render_product: function(product){
	        var cached = this.product_cache.get_node(product.id);
	        if(!cached){
	            var image_url = this.get_product_image_url(product);
	            var product_html = QWeb.render('LoungeProduct',{
	                    widget:  this,
	                    product: product,
	                    image_url: this.get_product_image_url(product),
	                });
	            var product_node = document.createElement('div');
	            product_node.innerHTML = product_html;
	            product_node = product_node.childNodes[1];
	            this.product_cache.cache_node(product.id,product_node);
	            return product_node;
	        }
	        return cached;
	    },

	    renderElement: function() {
	        var el_str  = QWeb.render(this.template, {widget: this});
	        var el_node = document.createElement('div');
	            el_node.innerHTML = el_str;
	            el_node = el_node.childNodes[1];

	        if(this.el && this.el.parentNode){
	            this.el.parentNode.replaceChild(el_node,this.el);
	        }
	        this.el = el_node;

	        var list_container = el_node.querySelector('.product-list');
	        for(var i = 0, len = this.product_list.length; i < len; i++){
	            var product_node = this.render_product(this.product_list[i]);
	            product_node.addEventListener('click',this.click_product_handler);
	            list_container.appendChild(product_node);
	        }
	    },
	});

	/* -------- The Action Buttons -------- */

	// Above the numpad and the actionpad, buttons
	// for extra actions and controls by point of
	// lounge extensions modules.

	var action_button_classes = [];
	var define_action_button = function(classe, options){
	    options = options || {};

	    var classes = action_button_classes;
	    var index   = classes.length;
	    var i;

	    if (options.after) {
	        for (i = 0; i < classes.length; i++) {
	            if (classes[i].name === options.after) {
	                index = i + 1;
	            }
	        }
	    } else if (options.before) {
	        for (i = 0; i < classes.length; i++) {
	            if (classes[i].name === options.after) {
	                index = i;
	                break;
	            }
	        }
	    }
	    classes.splice(i,0,classe);
	};

	var ActionButtonWidget = PosBaseWidget.extend({
	    template: 'LoungeActionButtonWidget',
	    label: _t('Button'),
	    renderElement: function(){
	        var self = this;
	        this._super();
	        this.$el.click(function(){
	            self.button_click();
	        });
	    },
	    button_click: function(){},
	    highlight: function(highlight){
	        this.$el.toggleClass('highlight',!!highlight);
	    },
	    // alternative highlight color
	    altlight: function(altlight){
	        this.$el.toggleClass('altlight',!!altlight);
	    },
	});

	/* -------- The Product Screen -------- */

	var ProductScreenWidget = ScreenWidget.extend({
	    template:'LoungeProductScreenWidget',

	    start: function(){
	        var self = this;

	        this.actionflight = new ActionflightWidget(this,{});
	        this.actionflight.replace(this.$('.placeholder-ActionflightWidget'));

	        this.actiontime = new ActiontimeWidget(this,{});
	        this.actiontime.replace(this.$('.placeholder-ActiontimeWidget'));

	        this.actioncheckout = new ActioncheckoutWidget(this,{});
	        this.actioncheckout.replace(this.$('.placeholder-ActioncheckoutWidget'));

	        this.actionpad = new ActionpadWidget(this,{});
	        this.actionpad.replace(this.$('.placeholder-ActionpadWidget'));

	        this.numpad = new NumpadWidget(this,{});
	        this.numpad.replace(this.$('.placeholder-NumpadWidget'));

	        this.order_widget = new OrderWidget(this,{
	            numpad_state: this.numpad.state,
	        });
	        this.order_widget.replace(this.$('.placeholder-OrderWidget'));

	        this.product_list_widget = new ProductListWidget(this,{
	            click_product_action: function(product){ self.click_product(product); },
	            product_list: this.lounge.db.get_product_by_category(0)
	        });
	        this.product_list_widget.replace(this.$('.placeholder-ProductListWidget'));

	        this.product_categories_widget = new ProductCategoriesWidget(this,{
	            product_list_widget: this.product_list_widget,
	        });
	        this.product_categories_widget.replace(this.$('.placeholder-ProductCategoriesWidget'));

	        this.action_buttons = {};
	        var classes = action_button_classes;
	        for (var i = 0; i < classes.length; i++) {
	            var classe = classes[i];
	            if ( !classe.condition || classe.condition.call(this) ) {
	                var widget = new classe.widget(this,{});
	                widget.appendTo(this.$('.control-buttons'));
	                this.action_buttons[classe.name] = widget;
	            }
	        }
	        if (_.size(this.action_buttons)) {
	            this.$('.control-buttons').removeClass('oe_hidden');
	        }
	    },

	    click_product: function(product) {
	       if(product.to_weight && this.lounge.config.iface_electronic_scale){
	           this.gui.show_screen('scale',{product: product});
	       }else{
	           this.lounge.get_order().add_product(product);
	       }
	    },

	    show: function(){
	        this._super();
	        this.product_categories_widget.reset_category();
	        this.numpad.state.reset();
	    },

	    close: function(){
	        this._super();
	        if(this.lounge.config.iface_vkeyboard && this.chrome.widget.keyboard){
	            this.chrome.widget.keyboard.hide();
	        }
	    },
	});
	gui.define_screen({name:'products', widget: ProductScreenWidget});

	/*--------------------------------------*\
	 |         THE CLIENT LIST              |
	\*======================================*/

	// The clientlist displays the list of customer,
	// and allows the cashier to create, edit and assign
	// customers.

	var ClientListScreenWidget = ScreenWidget.extend({
	    template: 'LoungeClientListScreenWidget',

	    init: function(parent, options){
	        this._super(parent, options);
	        this.partner_cache = new DomCache();
	    },

	    auto_back: true,

	    show: function(){
	        var self = this;
	        this._super();


	        this.renderElement();
	        this.details_visible = false;
	        this.old_client = this.lounge.get_order().get_client();

	        this.$('.back').click(function(){
	            self.gui.back();
	        });

	        this.$('.next').click(function(){
	            //self.lounge.get_order().finalize();
	            self.save_changes();
	            self.gui.back();// FIXME HUH ?
	        });

	        this.$('.new-customer').click(function(){
	            self.display_client_details('edit',{
	                'country_id': self.lounge.company.country_id,
	            });
	        });

	        var partners = this.lounge.db.get_partners_sorted(1000);
	        this.render_list(partners);

	        this.reload_partners();

	        if( this.old_client ){
	            this.display_client_details('show',this.old_client,0);
	        }

	        this.$('.client-list-contents').delegate('.client-line','click',function(event){
	            self.line_select(event,$(this),parseInt($(this).data('id')));
	        });

	        var search_timeout = null;

	        if(this.lounge.config.iface_vkeyboard && this.chrome.widget.keyboard){
	            this.chrome.widget.keyboard.connect(this.$('.searchbox input'));
	        }

	        this.$('.searchbox input').on('keypress',function(event){
	            clearTimeout(search_timeout);

	            var query = this.value;

	            search_timeout = setTimeout(function(){
	                self.perform_search(query,event.which === 13);
	            },70);
	        });

	        this.$('.searchbox .search-clear').click(function(){
	            self.clear_search();
	        });
	    },
	    hide: function () {
	        this._super();
	        this.new_client = null;
	    },
	    barcode_client_action: function(code){
	        if (this.editing_client) {
	            this.$('.detail.barcode').val(code.code);
	        } else if (this.lounge.db.get_partner_by_barcode(code.code)) {
	            var partner = this.lounge.db.get_partner_by_barcode(code.code);
	            this.new_client = partner;
	            this.display_client_details('show', partner);
	        }
	    },
	    perform_search: function(query, associate_result){
	        var customers;
	        if(query){
	            customers = this.lounge.db.search_partner(query);
	            this.display_client_details('hide');
	            if ( associate_result && customers.length === 1){
	                this.new_client = customers[0];
	                this.save_changes();
	                this.gui.back();
	            }
	            this.render_list(customers);
	        }else{
	            customers = this.lounge.db.get_partners_sorted();
	            this.render_list(customers);
	        }
	    },
	    clear_search: function(){
	        var customers = this.lounge.db.get_partners_sorted(1000);
	        this.render_list(customers);
	        this.$('.searchbox input')[0].value = '';
	        this.$('.searchbox input').focus();
	    },
	    render_list: function(partners){
	        var contents = this.$el[0].querySelector('.client-list-contents');
	        contents.innerHTML = "";
	        for(var i = 0, len = Math.min(partners.length,1000); i < len; i++){
	            var partner    = partners[i];
	            var clientline = this.partner_cache.get_node(partner.id);
	            if(!clientline){
	                var clientline_html = QWeb.render('LoungeClientLine',{widget: this, partner:partners[i]});
	                var clientline = document.createElement('tbody');
	                clientline.innerHTML = clientline_html;
	                clientline = clientline.childNodes[1];
	                this.partner_cache.cache_node(partner.id,clientline);
	            }
	            if( partner === this.old_client ){
	                clientline.classList.add('highlight');
	            }else{
	                clientline.classList.remove('highlight');
	            }
	            contents.appendChild(clientline);
	        }
	    },
	    save_changes: function(){
	        if( this.has_client_changed() ){
	            this.lounge.get_order().set_client(this.new_client);
	        }
	    },
	    has_client_changed: function(){
	        if( this.old_client && this.new_client ){
	            return this.old_client.id !== this.new_client.id;
	        }else{
	            return !!this.old_client !== !!this.new_client;
	        }
	    },
	    toggle_save_button: function(){
	        var $button = this.$('.button.next');
	        if (this.editing_client) {
	            $button.addClass('oe_hidden');
	            return;
	        } else if( this.new_client ){
	            if( !this.old_client){
	                $button.text(_t('Set This Customer'));
	            }else{
	                $button.text(_t('Change Customer'));
	            }
	        }else{
	            $button.text(_t('Deselect Customer'));
	        }
	        $button.toggleClass('oe_hidden',!this.has_client_changed());
	    },
	    line_select: function(event,$line,id){
	        var partner = this.lounge.db.get_partner_by_id(id);
	        this.$('.client-list .lowlight').removeClass('lowlight');
	        if ( $line.hasClass('highlight') ){
	            $line.removeClass('highlight');
	            $line.addClass('lowlight');
	            this.display_client_details('hide',partner);
	            this.new_client = null;
	            this.toggle_save_button();
	        }else{
	            this.$('.client-list .highlight').removeClass('highlight');
	            //$line.addClass('highlight');
	            $line.addClass('highlight');
	            var y = event.pageY - $line.parent().offset().top;
	            this.display_client_details('show',partner,y);
	            this.new_client = partner;
	            this.toggle_save_button();
	        }
	    },
	    partner_icon_url: function(id){
	        return '/web/image?model=res.partner&id='+id+'&field=image_small';
	    },

	    // ui handle for the 'edit selected customer' action
	    edit_client_details: function(partner) {
	        this.display_client_details('edit',partner);
	    },

	    // ui handle for the 'cancel customer edit changes' action
	    undo_client_details: function(partner) {
	        if (!partner.id) {
	            this.display_client_details('hide');
	        } else {
	            this.display_client_details('show',partner);
	        }
	    },

	    // what happens when we save the changes on the client edit form -> we fetch the fields, sanitize them,
	    // send them to the backend for update, and call saved_client_details() when the server tells us the
	    // save was successfull.
	    save_client_details: function(partner) {
	        var self = this;

	        var fields = {};
	        this.$('.client-details-contents .detail').each(function(idx,el){
	            fields[el.name] = el.value;
	        });

	        if (!fields.name) {
	            this.gui.show_popup('error',_t('A Customer Name Is Required'));
	            return;
	        }

	        if (this.uploaded_picture) {
	            fields.image = this.uploaded_picture;
	        }

	        fields.id           = partner.id || false;
	        fields.country_id   = fields.country_id || false;
	        fields.barcode      = fields.barcode || '';

	        new Model('res.partner').call('create_from_ui',[fields]).then(function(partner_id){
	            self.saved_client_details(partner_id);
	        },function(err,event){
	            event.preventDefault();
	            self.gui.show_popup('error',{
	                'title': _t('Error: Could not Save Changes'),
	                'body': _t('Your Internet connection is probably down.'),
	            });
	        });
	    },

	    // what happens when we've just pushed modifications for a partner of id partner_id
	    saved_client_details: function(partner_id){
	        var self = this;
	        this.reload_partners().then(function(){
	            var partner = self.lounge.db.get_partner_by_id(partner_id);
	            if (partner) {
	                self.new_client = partner;
	                self.toggle_save_button();
	                self.display_client_details('show',partner);
	            } else {
	                // should never happen, because create_from_ui must return the id of the partner it
	                // has created, and reload_partner() must have loaded the newly created partner.
	                self.display_client_details('hide');
	            }
	        });
	    },

	    // resizes an image, keeping the aspect ratio intact,
	    // the resize is useful to avoid sending 12Mpixels jpegs
	    // over a wireless connection.
	    resize_image_to_dataurl: function(img, maxwidth, maxheight, callback){
	        img.onload = function(){
	            var canvas = document.createElement('canvas');
	            var ctx    = canvas.getContext('2d');
	            var ratio  = 1;

	            if (img.width > maxwidth) {
	                ratio = maxwidth / img.width;
	            }
	            if (img.height * ratio > maxheight) {
	                ratio = maxheight / img.height;
	            }
	            var width  = Math.floor(img.width * ratio);
	            var height = Math.floor(img.height * ratio);

	            canvas.width  = width;
	            canvas.height = height;
	            ctx.drawImage(img,0,0,width,height);

	            var dataurl = canvas.toDataURL();
	            callback(dataurl);
	        };
	    },

	    // Loads and resizes a File that contains an image.
	    // callback gets a dataurl in case of success.
	    load_image_file: function(file, callback){
	        var self = this;
	        if (!file.type.match(/image.*/)) {
	            this.gui.show_popup('error',{
	                title: _t('Unsupported File Format'),
	                body:  _t('Only web-compatible Image formats such as .png or .jpeg are supported'),
	            });
	            return;
	        }

	        var reader = new FileReader();
	        reader.onload = function(event){
	            var dataurl = event.target.result;
	            var img     = new Image();
	            img.src = dataurl;
	            self.resize_image_to_dataurl(img,800,600,callback);
	        };
	        reader.onerror = function(){
	            self.gui.show_popup('error',{
	                title :_t('Could Not Read Image'),
	                body  :_t('The provided file could not be read due to an unknown error'),
	            });
	        };
	        reader.readAsDataURL(file);
	    },

	    // This fetches partner changes on the server, and in case of changes,
	    // rerenders the affected views
	    reload_partners: function(){
	        var self = this;
	        return this.lounge.load_new_partners().then(function(){
	            self.render_list(self.lounge.db.get_partners_sorted(1000));

	            // update the currently assigned client if it has been changed in db.
	            var curr_client = self.lounge.get_order().get_client();
	            if (curr_client) {
	                self.lounge.get_order().set_client(self.lounge.db.get_partner_by_id(curr_client.id));
	            }
	        });
	    },

	    // Shows,hides or edit the customer details box :
	    // visibility: 'show', 'hide' or 'edit'
	    // partner:    the partner object to show or edit
	    // clickpos:   the height of the click on the list (in pixel), used
	    //             to maintain consistent scroll.
	    display_client_details: function(visibility,partner,clickpos){
	        var self = this;
	        var contents = this.$('.client-details-contents');
	        var parent   = this.$('.client-list').parent();
	        var scroll   = parent.scrollTop();
	        var height   = contents.height();

	        contents.off('click','.button.edit');
	        contents.off('click','.button.save');
	        contents.off('click','.button.undo');
	        contents.on('click','.button.edit',function(){ self.edit_client_details(partner); });
	        contents.on('click','.button.save',function(){ self.save_client_details(partner); });
	        contents.on('click','.button.undo',function(){ self.undo_client_details(partner); });
	        this.editing_client = false;
	        this.uploaded_picture = null;

	        if(visibility === 'show'){
	            contents.empty();
	            contents.append($(QWeb.render('LoungeClientDetails',{widget:this,partner:partner})));

	            var new_height   = contents.height();

	            if(!this.details_visible){
	                if(clickpos < scroll + new_height + 20 ){
	                    parent.scrollTop( clickpos - 20 );
	                }else{
	                    parent.scrollTop(parent.scrollTop() + new_height);
	                }
	            }else{
	                parent.scrollTop(parent.scrollTop() - height + new_height);
	            }

	            this.details_visible = true;
	            this.toggle_save_button();
	        } else if (visibility === 'edit') {
	            this.editing_client = true;
	            contents.empty();
	            contents.append($(QWeb.render('LoungeClientDetailsEdit',{widget:this,partner:partner})));
	            this.toggle_save_button();

	            contents.find('.image-uploader').on('change',function(event){
	                self.load_image_file(event.target.files[0],function(res){
	                    if (res) {
	                        contents.find('.client-picture img, .client-picture .fa').remove();
	                        contents.find('.client-picture').append("<img src='"+res+"'>");
	                        contents.find('.detail.picture').remove();
	                        self.uploaded_picture = res;
	                    }
	                });
	            });
	        } else if (visibility === 'hide') {
	            contents.empty();
	            if( height > scroll ){
	                contents.css({height:height+'px'});
	                contents.animate({height:0},400,function(){
	                    contents.css({height:''});
	                });
	            }else{
	                parent.scrollTop( parent.scrollTop() - height);
	            }
	            this.details_visible = false;
	            this.toggle_save_button();
	        }
	    },
	    close: function(){
	        this._super();
	    },
	});
	gui.define_screen({name:'clientlist', widget: ClientListScreenWidget});

	/*--------------------------------------*\
	 |         THE RECEIPT SCREEN           |
	\*======================================*/

	// The receipt screen displays the order's
	// receipt and allows it to be printed in a web browser.
	// The receipt screen is not shown if the point of lounge
	// is set up to print with the proxy. Altough it could
	// be useful to do so...

	var ReceiptScreenWidget = ScreenWidget.extend({
	    template: 'LoungeReceiptScreenWidget',
	    show: function(){
	        this._super();
	        var self = this;

	        this.render_change();
	        this.render_receipt();

	        if (this.should_auto_print()) {
	            this.print();
	            if (this.should_close_immediately()){
	                this.click_next();
	            }
	        } else {
	            this.lock_screen(false);
	        }

	    },
	    should_auto_print: function() {
	        return this.lounge.config.iface_print_auto && !this.lounge.get_order()._printed;
	    },
	    should_close_immediately: function() {
	        return this.lounge.config.iface_print_via_proxy && this.lounge.config.iface_print_skip_screen;
	    },
	    lock_screen: function(locked) {
	        this._locked = locked;
	        if (locked) {
	            this.$('.next').removeClass('highlight');
	        } else {
	            this.$('.next').addClass('highlight');
	        }
	    },
	    print_web: function() {
	        window.print();
	        this.lounge.get_order()._printed = true;
	    },
	    print_xml: function() {
	        var env = {
	            widget:  this,
	            lounge:  this.lounge,
	            order:   this.lounge.get_order(),
	            receipt: this.lounge.get_order().export_for_printing(),
	            paymentlines: this.lounge.get_order().get_paymentlines()
	        };
	        var receipt = QWeb.render('LoungeXmlReceipt',env);

	        this.lounge.proxy.print_receipt(receipt);
	        this.lounge.get_order()._printed = true;
	    },
	    print: function() {
	        var self = this;

	        if (!this.lounge.config.iface_print_via_proxy) { // browser (html) printing

	            // The problem is that in chrome the print() is asynchronous and doesn't
	            // execute until all rpc are finished. So it conflicts with the rpc used
	            // to send the orders to the backend, and the user is able to go to the next
	            // screen before the printing dialog is opened. The problem is that what's
	            // printed is whatever is in the page when the dialog is opened and not when it's called,
	            // and so you end up printing the product list instead of the receipt...
	            //
	            // Fixing this would need a re-architecturing
	            // of the code to postpone sending of orders after printing.
	            //
	            // But since the print dialog also blocks the other asynchronous calls, the
	            // button enabling in the setTimeout() is blocked until the printing dialog is
	            // closed. But the timeout has to be big enough or else it doesn't work
	            // 1 seconds is the same as the default timeout for sending orders and so the dialog
	            // should have appeared before the timeout... so yeah that's not ultra reliable.

	            this.lock_screen(true);

	            setTimeout(function(){
	                self.lock_screen(false);
	            }, 1000);

	            this.print_web();
	        } else {    // proxy (xml) printing
	            this.print_xml();
	            this.lock_screen(false);
	        }
	    },
	    click_next: function() {
	        this.lounge.get_order().finalize();
	    },
	    click_back: function() {
	        // Placeholder method for ReceiptScreen extensions that
	        // can go back ...
	    },
	    renderElement: function() {
	        var self = this;
	        this._super();
	        this.$('.next').click(function(){
	            if (!self._locked) {
	                self.click_next();
	            }
	        });
	        this.$('.back').click(function(){
	            if (!self._locked) {
	                self.click_back();
	            }
	        });
	        this.$('.button.print').click(function(){
	            if (!self._locked) {
	                self.print();
	            }
	        });
	    },
	    render_change: function() {
	        this.$('.change-value').html(this.format_currency(this.lounge.get_order().get_change()));
	    },
	    render_receipt: function() {
	        var order = this.lounge.get_order();
	        this.$('.pos-receipt-container').html(QWeb.render('LoungePosTicket',{
	                widget:this,
	                order: order,
	                receipt: order.export_for_printing(),
	                orderlines: order.get_orderlines(),
	                paymentlines: order.get_paymentlines(),
	            }));
	    },
	});
	gui.define_screen({name:'receipt', widget: ReceiptScreenWidget});

	/*--------------------------------------*\
	 |         THE PAYMENT SCREEN           |
	\*======================================*/

	// The Payment Screen handles the payments, and
	// it is unfortunately quite complicated.

	var PaymentScreenWidget = ScreenWidget.extend({
	    template:      'LoungePaymentScreenWidget',
	    back_screen:   'product',
	    init: function(parent, options) {
	        var self = this;
	        this._super(parent, options);
	        //this.booking_from_date = this.lounge.get_order().get_booking_from_date();
	        this.lounge.bind('change:selectedOrder',function(){
	                this.renderElement();
	                this.watch_order_changes();
	            },this);
	        this.watch_order_changes();

	        this.inputbuffer = 0;
	        this.firstinput  = true;
	        this.decimal_point = _t.database.parameters.decimal_point;

	        // This is a keydown handler that prevents backspace from
	        // doing a back navigation. It also makes sure that keys that
	        // do not generate a keypress in Chrom{e,ium} (eg. delete,
	        // backspace, ...) get passed to the keypress handler.
	        this.keyboard_keydown_handler = function(event){
	            if (event.keyCode === 8 || event.keyCode === 46) { // Backspace and Delete
	                event.preventDefault();

	                // These do not generate keypress events in
	                // Chrom{e,ium}. Even if they did, we just called
	                // preventDefault which will cancel any keypress that
	                // would normally follow. So we call keyboard_handler
	                // explicitly with this keydown event.
	                self.keyboard_handler(event);
	            }
	        };

	        // This keyboard handler listens for keypress events. It is
	        // also called explicitly to handle some keydown events that
	        // do not generate keypress events.
	        this.keyboard_handler = function(event){
	            var key = '';

	            if (event.type === "keypress") {
	                if (event.keyCode === 13) { // Enter
	                    self.validate_order();
	                } else if ( event.keyCode === 190 || // Dot
	                            event.keyCode === 110 ||  // Decimal point (numpad)
	                            event.keyCode === 188 ||  // Comma
	                            event.keyCode === 46 ) {  // Numpad dot
	                    key = self.decimal_point;
	                } else if (event.keyCode >= 48 && event.keyCode <= 57) { // Numbers
	                    key = '' + (event.keyCode - 48);
	                } else if (event.keyCode === 45) { // Minus
	                    key = '-';
	                } else if (event.keyCode === 43) { // Plus
	                    key = '+';
	                }
	            } else { // keyup/keydown
	                if (event.keyCode === 46) { // Delete
	                    key = 'CLEAR';
	                } else if (event.keyCode === 8) { // Backspace
	                    key = 'BACKSPACE';
	                }
	            }

	            self.payment_input(key);
	            event.preventDefault();
	        };

	        this.lounge.bind('change:selectedClient', function() {
	            self.customer_changed();
	        }, this);


	    },
	    // resets the current input buffer
	    reset_input: function(){
	        var line = this.lounge.get_order().selected_paymentline;
	        this.firstinput  = true;
	        if (line) {
	            this.inputbuffer = this.format_currency_no_symbol(line.get_amount());
	        } else {
	            this.inputbuffer = "";
	        }
	    },
	    // handle both keyboard and numpad input. Accepts
	    // a string that represents the key pressed.
	    payment_input: function(input) {
	        var newbuf = this.gui.numpad_input(this.inputbuffer, input, {'firstinput': this.firstinput});

	        this.firstinput = (newbuf.length === 0);

	        // popup block inputs to prevent sneak editing.
	        if (this.gui.has_popup()) {
	            return;
	        }

	        if (newbuf !== this.inputbuffer) {
	            this.inputbuffer = newbuf;
	            var order = this.lounge.get_order();
	            if (order.selected_paymentline) {
	                var amount = this.inputbuffer;

	                if (this.inputbuffer !== "-") {
	                    amount = formats.parse_value(this.inputbuffer, {type: "float"}, 0.0);
	                }

	                order.selected_paymentline.set_amount(amount);
	                this.order_changes();
	                this.render_paymentlines();
	                this.$('.paymentline.selected .edit').text(this.format_currency_no_symbol(amount));
	            }
	        }
	    },
	    click_numpad: function(button) {
		var paymentlines = this.lounge.get_order().get_paymentlines();
		var open_paymentline = false;

		for (var i = 0; i < paymentlines.length; i++) {
		    if (! paymentlines[i].paid) {
			open_paymentline = true;
		    }
		}

		if (! open_paymentline) {
	            this.lounge.get_order().add_paymentline( this.lounge.cashregisters[0]);
	            this.render_paymentlines();
	        }

	        this.payment_input(button.data('action'));
	    },
	    render_numpad: function() {
	        var self = this;
	        var numpad = $(QWeb.render('LoungePaymentScreen-Numpad', { widget:this }));
	        numpad.on('click','button',function(){
	            self.click_numpad($(this));
	        });
	        return numpad;
	    },
	    click_delete_paymentline: function(cid){
	        var lines = this.lounge.get_order().get_paymentlines();
	        for ( var i = 0; i < lines.length; i++ ) {
	            if (lines[i].cid === cid) {
	                this.lounge.get_order().remove_paymentline(lines[i]);
	                this.reset_input();
	                this.render_paymentlines();
	                return;
	            }
	        }
	    },
	    click_paymentline: function(cid){
	        var lines = this.lounge.get_order().get_paymentlines();
	        for ( var i = 0; i < lines.length; i++ ) {
	            if (lines[i].cid === cid) {
	                this.lounge.get_order().select_paymentline(lines[i]);
	                this.reset_input();
	                this.render_paymentlines();
	                return;
	            }
	        }
	    },
	    render_paymentlines: function() {
	        var self  = this;
	        var order = this.lounge.get_order();
	        if (!order) {
	            return;
	        }

	        var lines = order.get_paymentlines();
	        var due   = order.get_due();
	        var extradue = 0;
	        if (due && lines.length  && due !== order.get_due(lines[lines.length-1])) {
	            extradue = due;
	        }


	        this.$('.paymentlines-container').empty();
	        var lines = $(QWeb.render('LoungePaymentScreen-Paymentlines', {
	            widget: this,
	            order: order,
	            paymentlines: lines,
	            extradue: extradue,
	        }));

	        lines.on('click','.delete-button',function(){
	            self.click_delete_paymentline($(this).data('cid'));
	        });

	        lines.on('click','.paymentline',function(){
	            self.click_paymentline($(this).data('cid'));
	        });

	        lines.appendTo(this.$('.paymentlines-container'));
	    },
	    click_paymentmethods: function(id) {
	        var cashregister = null;
	        for ( var i = 0; i < this.lounge.cashregisters.length; i++ ) {
	            if ( this.lounge.cashregisters[i].journal_id[0] === id ){
	                cashregister = this.lounge.cashregisters[i];
	                break;
	            }
	        }
	        this.lounge.get_order().add_paymentline( cashregister );
	        this.reset_input();
	        this.render_paymentlines();
	    },
	    render_paymentmethods: function() {
	        var self = this;
	        var methods = $(QWeb.render('LoungePaymentScreen-Paymentmethods', { widget:this }));
	            methods.on('click','.paymentmethod',function(){
	                self.click_paymentmethods($(this).data('id'));
	            });
	        return methods;
	    },
	    click_invoice: function(){
	        var order = this.lounge.get_order();
	        order.set_to_invoice(!order.is_to_invoice());
	        if (order.is_to_invoice()) {
	            this.$('.js_invoice').addClass('highlight');
	        } else {
	            this.$('.js_invoice').removeClass('highlight');
	        }
	    },
	    click_tip: function(){
	        var self   = this;
	        var order  = this.lounge.get_order();
	        var tip    = order.get_tip();
	        var change = order.get_change();
	        var value  = tip;

	        if (tip === 0 && change > 0  ) {
	            value = change;
	        }

	        this.gui.show_popup('number',{
	            'title': tip ? _t('Change Tip') : _t('Add Tip'),
	            'value': self.format_currency_no_symbol(value),
	            'confirm': function(value) {
	                order.set_tip(formats.parse_value(value, {type: "float"}, 0));
	                self.order_changes();
	                self.render_paymentlines();
	            }
	        });
	    },
	    customer_changed: function() {
	        var client = this.lounge.get_client();
	        this.$('.js_customer_name').text( client ? client.name : _t('Customer') );

	    },
	    time_changed: function() {
	        var booking_from_date = this.lounge.get_order().get_booking_from_date();
	        var booking_to_date = this.lounge.get_order().get_booking_to_date();
	        this.$('.js_booking_from_date').text( booking_from_date ? booking_from_date : _t('None') );
	        this.$('.js_booking_to_date').text( booking_to_date ? booking_to_date : _t('None') );
	        this.$('.js_flight_type').text( this.lounge.get_flight_type() ? this.lounge.get_flight_type() : _t('Domestic') );
	        this.$('.js_flight_number').text( this.lounge.get_flight_number() ? this.lounge.get_flight_number() : _t('None') );
	    },
	    click_set_customer: function(){
	        this.gui.show_screen('clientlist');
	    },
	    click_back: function(){
	        this.gui.show_screen('products');
	    },
	    renderElement: function() {
	        var self = this;
	        this._super();

	        var numpad = this.render_numpad();
	        numpad.appendTo(this.$('.payment-numpad'));

	        var methods = this.render_paymentmethods();
	        methods.appendTo(this.$('.paymentmethods-container'));

	        this.render_paymentlines();

	        this.$('.back').click(function(){
	            self.click_back();
	        });

	        this.$('.next').click(function(){
	            jQuery(".booking_from_date").val("");
				jQuery(".booking_to_date").val("");
	            self.validate_order();
	        });

	        this.$('.js_set_customer').click(function(){
	            self.click_set_customer();
	        });

	        this.$('.js_tip').click(function(){
	            self.click_tip();
	        });
	        this.$('.js_invoice').click(function(){
	            self.click_invoice();
	        });

	        this.$('.js_cashdrawer').click(function(){
	            self.lounge.proxy.open_cashbox();
	        });

	    },
	    show: function(){
	        this.time_changed();
	        this.lounge.get_order().clean_empty_paymentlines();
	        this.reset_input();
	        this.render_paymentlines();
	        this.order_changes();
	        window.document.body.addEventListener('keypress',this.keyboard_handler);
	        window.document.body.addEventListener('keydown',this.keyboard_keydown_handler);
	        this._super();
	    },
	    hide: function(){
	        window.document.body.removeEventListener('keypress',this.keyboard_handler);
	        window.document.body.removeEventListener('keydown',this.keyboard_keydown_handler);
	        this._super();
	    },
	    // sets up listeners to watch for order changes
	    watch_order_changes: function() {
	        var self = this;
	        var order = this.lounge.get_order();
	        if (!order) {
	            return;
	        }
	        if(this.old_order){
	            this.old_order.unbind(null,null,this);
	        }
	        order.bind('all',function(){
	            self.order_changes();
	        });
	        this.old_order = order;
	    },
	    // called when the order is changed, used to show if
	    // the order is paid or not
	    order_changes: function(){
	        var self = this;
	        var order = this.lounge.get_order();
	        if (!order) {
	            return;
	        } else if (order.is_paid()) {
	            self.$('.next').addClass('highlight');
	        }else{
	            self.$('.next').removeClass('highlight');
	        }
	    },
	    // Check if the order is paid, then sends it to the backend,
	    // and complete the sale process
	    validate_order: function(force_validation) {
	        var self = this;
	        var order = this.lounge.get_order();

	        // FIXME: this check is there because the backend is unable to
	        // process empty orders. This is not the right place to fix it.
	        if (order.get_orderlines().length === 0) {
	            this.gui.show_popup('error',{
	                'title': _t('Empty Order'),
	                'body':  _t('There must be at least one product sale in your order before it can be validated'),
	            });
	            return;
	        }

	        var plines = order.get_paymentlines();
	        for (var i = 0; i < plines.length; i++) {
	            if (plines[i].get_type() === 'bank' && plines[i].get_amount() < 0) {
	                this.lounge_widget.screen_selector.show_popup('error',{
	                    'message': _t('Negative Bank Payment'),
	                    'comment': _t('You cannot have a negative amount in a Bank payment. Use a cash payment method to return money to the customer.'),
	                });
	                return;
	            }
	        }

	        if (!order.is_paid() || this.invoicing) {
	            return;
	        }

	        // The exact amount must be paid if there is no cash payment method defined.
	        if (Math.abs(order.get_total_with_tax() - order.get_total_paid()) > 0.00001) {
	            var cash = false;
	            for (var i = 0; i < this.lounge.cashregisters.length; i++) {
	                cash = cash || (this.lounge.cashregisters[i].journal.type === 'cash');
	            }
	            if (!cash) {
	                this.gui.show_popup('error',{
	                    title: _t('Cannot return change without a cash payment method'),
	                    body:  _t('There is no cash payment method available in this point of sale to handle the change.\n\n Please pay the exact amount or add a cash payment method in the point of sale configuration'),
	                });
	                return;
	            }
	        }

	        // if the change is too large, it's probably an input error, make the user confirm.
	        if (!force_validation && (order.get_total_with_tax() * 1000 < order.get_total_paid())) {
	            this.gui.show_popup('confirm',{
	                title: _t('Please Confirm Large Amount'),
	                body:  _t('Are you sure that the customer wants to  pay') +
	                       ' ' +
	                       this.format_currency(order.get_total_paid()) +
	                       ' ' +
	                       _t('for an order of') +
	                       ' ' +
	                       this.format_currency(order.get_total_with_tax()) +
	                       ' ' +
	                       _t('? Clicking "Confirm" will validate the payment.'),
	                confirm: function() {
	                    self.validate_order('confirm');
	                },
	            });
	            return;
	        }

	        if (order.is_paid_with_cash() && this.lounge.config.iface_cashdrawer) {

	                this.lounge.proxy.open_cashbox();
	        }

	        order.initialize_validation_date();

	        if (order.is_to_invoice()) {
	            var invoiced = this.lounge.push_and_invoice_order(order);
	            this.invoicing = true;

	            invoiced.fail(function(error){
	                self.invoicing = false;
	                if (error.message === 'Missing Customer') {
	                    self.gui.show_popup('confirm',{
	                        'title': _t('Please select the Customer'),
	                        'body': _t('You need to select the customer before you can invoice an order.'),
	                        confirm: function(){
	                            self.gui.show_screen('clientlist');
	                        },
	                    });
	                } else if (error.code < 0) {        // XmlHttpRequest Errors
	                    self.gui.show_popup('error',{
	                        'title': _t('The order could not be sent'),
	                        'body': _t('Check your internet connection and try again.'),
	                    });
	                } else if (error.code === 200) {    // OpenERP Server Errors
	                    self.gui.show_popup('error-traceback',{
	                        'title': error.data.message || _t("Server Error"),
	                        'body': error.data.debug || _t('The server encountered an error while receiving your order.'),
	                    });
	                } else {                            // ???
	                    self.gui.show_popup('error',{
	                        'title': _t("Unknown Error"),
	                        'body':  _t("The order could not be sent to the server due to an unknown error"),
	                    });
	                }
	            });

	            invoiced.done(function(){
	                self.invoicing = false;
	                order.finalize();
	            });
	        } else {
	            this.lounge.push_order(order);
	            this.gui.show_screen('receipt');
	        }
	    },
	});
	gui.define_screen({name:'payment', widget: PaymentScreenWidget});

	/*--------------------------------------*\
	 |         THE LAST ORDER LIST              |
	\*======================================*/

	// The orderlist displays the list of customer,
	// and allows the cashier to create, edit and assign
	// orders.

	var OrderListScreenWidget = ScreenWidget.extend({
	    template: 'LoungeOrderListScreenWidget',
	    init: function(parent, options){
	        this._super(parent, options);
	        this.order_cache = new DomCache();
	        this.order_line_cache = new DomCache();
	    },
	    auto_back: true,
	    show: function(){
	        var self = this;
	        this._super();
	        this.renderElement();

	        this.$('.back').click(function() {
	            self.gui.back();
	        });

	        this.$('.next').click(function(){
	            self.gui.show_screen('order_payment');
	        });

	        var orders = this.lounge.db.get_orders_sorted(1000);
	        this.render_list(orders);

	        //click order
            this.$('.order-list-contents').delegate('.order-line','click',function(event){
	            self.line_select(event,$(this),parseInt($(this).data('id')));
	        });

	        var search_timeout = null;

	        if(this.lounge.config.iface_vkeyboard && this.chrome.widget.keyboard){
	            this.chrome.widget.keyboard.connect(this.$('.searchorder input'));
	        }

	        this.$('.searchorder input').on('keypress',function(event){
	            clearTimeout(search_timeout);
	            var query = this.value;

	            search_timeout = setTimeout(function() {
	                self.perform_search(query,event.which === 13);
	            },70);
	        });

	        this.$('.searchorder .search-clear').click(function(){
	            self.clear_search();
	        });

	    },
	    perform_search: function(query, associate_result){
	        var orders;
	        if(query){
	            orders = this.lounge.db.search_order(query);
	            this.display_order_details('hide');

	            if(associate_result && orders.length === 1) {
	                this.gui.back();
	            }

	            this.render_list(orders);

	        } else {
	           orders = this.lounge.db.get_orders_sorted();
	           this.render_list(orders);
	        }

	    },
	    clear_search: function(){
            var orders = this.lounge.db.get_orders_sorted(1000);
            this.render_list(orders);
            this.$('.searchorder input')[0].value = '';
	        this.$('.searchorder input').focus();
	    },
	    render_list: function(orders){
	        var contents = this.$el[0].querySelector('.order-list-contents');
	        contents.innerHTML = "";
	        for(var i = 0, len = Math.min(orders.length,1000); i < len; i++){
	            var order = orders[i];
	            var orderline = this.order_cache.get_node(order.id);

	            if(!orderline){
	                var orderline_html = QWeb.render('LoungeOrderLine',{widget: this, order:orders[i]});
	                var orderline = document.createElement('tbody');
	                orderline.innerHTML = orderline_html;
	                orderline = orderline.childNodes[1];
	                this.order_cache.cache_node(order.id,orderline);
	            }

	            contents.appendChild(orderline);
	        }
	    },
	    line_select: function(event,$line,id) {
	        var order = this.lounge.db.get_order_by_id(id);
	        this.$('.order-list .lowlight').removeClass('lowlight');
	        if ( $line.hasClass('highlight') ){
	            $line.removeClass('highlight');
	            $line.addClass('lowlight');
	            this.display_order_details('hide',order);
	            this.toggle_save_button();

	        } else {
	            this.$('.order-list .highlight').removeClass('highlight');
	            $line.addClass('highlight');
	            var y = event.pageY - $line.parent().offset().top;
	            this.display_order_details('show',order,y);
	            this.toggle_save_button();

	        }
	    },
	    display_order_details: function(visibility,order,clickpos) {
	        var self = this;
	        var contents = this.$('.order-details-contents');
	        var parent   = this.$('.order-list').parent();
	        var scroll   = parent.scrollTop();
	        var height   = contents.height();

	        if(visibility === 'show') {
	            var utc = new Date();
                var checkin_date  = moment(order.booking_from_date);
                var duration = moment.duration(moment(utc).diff(checkin_date));
                var data = {
                    'current_date': moment(utc).format('YYYY-MM-DD hh:mm:ss'),
                    'total_hours' : Math.ceil(duration.asHours()),
                    'last_payment' :  order.amount_total,
                };

	            contents.empty();
	            contents.append($(QWeb.render('LoungeOrderDetails',{widget:this,order:order,date:data})));
	            var new_height   = contents.height();

	            if(!this.details_visible){
	                if(clickpos < scroll + new_height + 20 ){
	                    parent.scrollTop( clickpos - 20 );
	                } else {
	                    parent.scrollTop(parent.scrollTop() + new_height);
	                }
	            } else {
	                parent.scrollTop(parent.scrollTop() - height + new_height);
	            }

	            this.details_visible = true;
	            var query = order.name;
	            var order_lines = this.lounge.db.search_order_line(query);
	            this.render_line_list(order_lines,data);

	        } else if (visibility === 'hide') {
	            contents.empty();
	            if( height > scroll ){
	                contents.css({height:height+'px'});
	                contents.animate({height:0},400,function() {
	                    contents.css({height:''});
	                });
	            }else{
	                parent.scrollTop( parent.scrollTop() - height);
	            }

	            this.details_visible = false;
	        }
	    },
	    render_line_list: function(order_lines,data){
	        var linecontents = this.$el[0].querySelector('.orderline-list-contents');
	        linecontents.innerHTML = "";
	        var subtotal = 0;
	        var surcharge = 0;
	        var params  = {};
	        var charge;
	        var total_hour;
	        var hour_if_charge;
	        var total_hour_charge;
	        var total_charge;

	        for(var i = 0, len = Math.min(order_lines.length,1000); i < len; i++) {
	            var order_line = order_lines[i];
	            var orderline = this.order_line_cache.get_node(order_line.id);

	            if(order_line.price_subtotal_incl)
	                subtotal+=order_line.price_subtotal_incl;

                /**
                 * Calculation Charge
                */
                charge = !order_line.lounge_charge ? 0 : order_line.lounge_charge;
	            total_hour = data['total_hours'];
	            hour_if_charge = !order_line.lounge_charge_every ? 0 : order_line.lounge_charge_every;
	            total_hour_charge = total_hour == 0 ? 0 : Math.round(total_hour / hour_if_charge);
	            total_charge = (total_hour_charge <= 1 || !total_hour_charge) ? 0 : (Math.round(charge * (total_hour_charge - 1)));
	            order_line.total_charge = total_charge;
	            order_line.subtotal = total_charge + order_line.price_subtotal_incl;
	            subtotal+=order_line.subtotal;

	            if(!orderline){
	                var orderline_html = QWeb.render('LoungeOrderDetailLine',{widget: this, order_line:order_lines[i]});
	                var orderline = document.createElement('tbody');
	                orderline.innerHTML = orderline_html;
	                orderline = orderline.childNodes[1];
	                this.order_line_cache.cache_node(order_line.id,orderline);
	            }
	            linecontents.appendChild(orderline);
	        }

	        /* SUMMARY LINE */
	        var vcontents = this.$('.orderline-list-total');
	        var total_payment = subtotal > data['last_payment'] ? subtotal - data['last_payment'] : 0;
	        vcontents.empty();
	        params = {
	            'subtotal' : subtotal,
	            'last_payment' : data['last_payment'],
	            'total_payment' : total_payment,
	        };
	        vcontents.append($(QWeb.render('LoungeOrderDetailLineTotal',{widget:this,params:params})));

	    },
	    toggle_save_button: function(){
	        var $button = this.$('.button.next');
	        /*if (this.editing_order) {
	            $button.addClass('oe_hidden');
	            return;
	        } else if(this.new_order){
	            if(!this.old_order){
	                $button.text(_t('Set This Order'));
	            }else{
	                $button.text(_t('Change Order'));
	            }
	        }else{
	            $button.text(_t('Payment'));
	        }*/
	        $button.text(_t('Payment'));
	        $button.toggleClass('oe_hidden',!this.has_order_changed());
	    },
	    has_order_changed: function() {
	        /*if( this.old_order && this.new_order ){
	            return this.old_order.id !== this.new_order.id;
	        }else{
	            return !!this.old_order !== !!this.new_order;
	        }*/
	        return true;
	    },
	    hide: function () {
	        this._super();
	    },
	    close: function(){
	        this._super();
	    },
	});
	gui.define_screen({name:'orderlist', widget: OrderListScreenWidget});

	/*--------------------------------------*\
	 |         THE ORDER CHARGE PAYMENT SCREEN           |
	\*======================================*/

	// The Payment Screen handles the order charge payments, and
	// it is unfortunately quite complicated.
    var OrderPaymentScreenWidget = ScreenWidget.extend({
        template: 'LoungeOrderPaymentScreenWidget',
        back_screen:'product',
        init: function(parent, options) {
            var self = this;
	        this._super(parent, options);
	        this.lounge.bind('change:selectedOrder',function(){
	            this.renderElement();
	            this.watch_order_changes();
	        },this);
	        this.watch_order_changes();

	        this.inputbuffer = "";
	        this.firstinput  = true;
	        this.decimal_point = _t.database.parameters.decimal_point;

	        // This is a keydown handler that prevents backspace from
	        // doing a back navigation. It also makes sure that keys that
	        // do not generate a keypress in Chrom{e,ium} (eg. delete,
	        // backspace, ...) get passed to the keypress handler.
	        this.keyboard_keydown_handler = function(event){
	            if (event.keyCode === 8 || event.keyCode === 46) { // Backspace and Delete
	                event.preventDefault();
	                 // These do not generate keypress events in
	                // Chrom{e,ium}. Even if they did, we just called
	                // preventDefault which will cancel any keypress that
	                // would normally follow. So we call keyboard_handler
	                // explicitly with this keydown event.
	                self.keyboard_handler(event);
	            }
	        };

	        // This keyboard handler listens for keypress events. It is
	        // also called explicitly to handle some keydown events that
	        // do not generate keypress events.
	        this.keyboard_handler = function(event){
	            var key = '';
	            if (event.type === "keypress") {
                    if (event.keyCode === 13) { // Enter
                        self.validate_order();
                    } else if ( event.keyCode === 190 || // Dot
	                            event.keyCode === 110 ||  // Decimal point (numpad)
	                            event.keyCode === 188 ||  // Comma
	                            event.keyCode === 46 ) {  // Numpad dot
	                    key = self.decimal_point;
	                }else if (event.keyCode >= 48 && event.keyCode <= 57) { // Numbers
	                    key = '' + (event.keyCode - 48);
	                } else if (event.keyCode === 45) { // Minus
	                    key = '-';
	                } else if (event.keyCode === 43) { // Plus
	                    key = '+';
	                }
	            } else { // keyup/keydown
	                if (event.keyCode === 46) { // Delete
	                    key = 'CLEAR';
	                } else if (event.keyCode === 8) { // Backspace
	                    key = 'BACKSPACE';
	                }
	            }

	            self.payment_input(key);
	            event.preventDefault();
	        };

	        this.lounge.bind('change:selectedClient', function() {
	            self.customer_changed();
	        }, this);

        },
        renderElement: function() {
            var self = this;
	        this._super();

            //numpad
	        var numpad = this.render_numpad();
	        numpad.appendTo(this.$('.payment-numpad'));


	        var methods = this.render_paymentmethods();
	        methods.appendTo(this.$('.paymentmethods-container'));

	        this.render_paymentlines();

	        this.$('.back').click(function(){
	            self.click_back();
	        });

	        this.$('.next').click(function(){
	            self.validate_order();
	        });

	        this.$('.js_set_customer').click(function(){
	            self.click_set_customer();
	        });
        },
        render_numpad: function() {
            var self = this;
	        var numpad = $(QWeb.render('LoungeOrderPaymentScreen-Numpad', { widget:this }));
	        numpad.on('click','button',function(){
	            self.click_numpad($(this));
	        });
	        return numpad;
        },
        click_numpad: function(button) {
		    var paymentlines = this.lounge.get_order().get_paymentlines();
		    var open_paymentline = false;

            for (var i = 0; i < paymentlines.length; i++) {
                if (! paymentlines[i].paid) {
                    open_paymentline = true;
                }
            }

            if (! open_paymentline) {
                    this.lounge.get_order().add_paymentline( this.lounge.cashregisters[0]);
                    this.render_paymentlines();
                }

	        this.payment_input(button.data('action'));
	    },
        watch_order_changes: function() {
            var self = this;
            var order = this.lounge.get_order();

            if (!order) {
	            return;
	        }

	        if(this.old_order){
	            this.old_order.unbind(null,null,this);
	        }

	        order.bind('all',function(){
	            self.order_changes();
	        });

	        this.old_order = order;
        },
        payment_input: function(input) {
            var newbuf = this.gui.numpad_input(this.inputbuffer, input, {'firstinput': this.firstinput});
            this.firstinput = (newbuf.length === 0);

            // popup block inputs to prevent sneak editing.
	        if (this.gui.has_popup()) {
	            return;
	        }

	        if (newbuf !== this.inputbuffer) {
	            this.inputbuffer = newbuf;
	            var order = this.lounge.get_order();
	            if (order.selected_paymentline) {
	                var amount = this.inputbuffer;
	                if (this.inputbuffer !== "-") {
	                    amount = formats.parse_value(this.inputbuffer, {type: "float"}, 0.0);
	                }

	                order.selected_paymentline.set_amount(amount);
	                this.order_changes();
	                this.render_paymentlines();
	                this.$('.paymentline.selected .edit').text(this.format_currency_no_symbol(amount));
	            }
	        }
        },
        // called when the order is changed, used to show if
	    // the order is paid or not
	    order_changes: function(){
	        var self = this;
	        var order = this.lounge.get_order();
	        if (!order) {
	            return;
	        } else if (order.is_paid()) {
	            self.$('.next').addClass('highlight');
	        }else{
	            self.$('.next').removeClass('highlight');
	        }
	    },
        click_back: function(){
	        this.gui.show_screen('orderlist');
	    },
	    render_paymentmethods: function() {
	        var self = this;
	        var methods = $(QWeb.render('LoungeOrderPaymentScreen-Paymentmethods', { widget:this }));
	        methods.on('click','.paymentmethod',function(){
	            self.click_paymentmethods($(this).data('id'));
	        });
	        return methods;
	    },
	    click_paymentmethods: function(id) {
	        var cashregister = null;
	        for ( var i = 0; i < this.lounge.cashregisters.length; i++ ) {
	            if ( this.lounge.cashregisters[i].journal_id[0] === id ){
	                cashregister = this.lounge.cashregisters[i];
	                break;
	            }
	        }
	        this.lounge.get_order().add_paymentline(cashregister); //important
	        this.reset_input();
	        this.render_paymentlines();
	    },
	    reset_input: function(){
	        var line = this.lounge.get_order().selected_paymentline;
	        this.firstinput  = true;
	        if (line) {
	            this.inputbuffer = this.format_currency_no_symbol(line.get_amount());
	        } else {
	            this.inputbuffer = "";
	        }
	    },
	    render_paymentlines: function() {
            var self  = this;
            var order = this.lounge.get_order();
	        if (!order) {
	            return;
	        }

	        var lines = order.get_paymentlines();
	        var due   = order.get_due();
	        var extradue = 0;
	        if (due && lines.length  && due !== order.get_due(lines[lines.length-1])) {
	            extradue = due;
	        }

	        this.$('.paymentlines-container').empty();
	        var lines = $(QWeb.render('LoungeOrderPaymentScreen-Paymentlines', {
	            widget: this,
	            order: order,
	            paymentlines: lines,
	            extradue: extradue,
	        }));

	        lines.on('click','.delete-button',function(){
	            self.click_delete_paymentline($(this).data('cid'));
	        });

	        lines.on('click','.paymentline',function(){
	            self.click_paymentline($(this).data('cid'));
	        });

	        lines.appendTo(this.$('.paymentlines-container'));
	    },
	    click_paymentline: function(cid){
	        var lines = this.lounge.get_order().get_paymentlines();
	        for ( var i = 0; i < lines.length; i++ ) {
	            if (lines[i].cid === cid) {
	                this.lounge.get_order().select_paymentline(lines[i]);
	                this.reset_input();
	                this.render_paymentlines();
	                return;
	            }
	        }
	    },
	    click_delete_paymentline: function(cid){
	        var lines = this.lounge.get_order().get_paymentlines();
	        for ( var i = 0; i < lines.length; i++ ) {
                if (lines[i].cid === cid) {
                    this.lounge.get_order().remove_paymentline(lines[i]);
                    this.reset_input();
                    this.render_paymentlines();
	                return;
                }
	        }
	    },
	    customer_changed: function() {
	        var client = this.lounge.get_client();
	        this.$('.js_customer_name').text( client ? client.name : _t('Guest') );

	    },
	    click_set_customer: function(){
	        this.gui.show_screen('clientlist');
	    },
	    validate_order: function(force_validation) {
	        var self = this;
	        var order = this.lounge.get_order();

	        // FIXME: this check is there because the backend is unable to
	        // process empty orders. This is not the right place to fix it.
	        if (order.get_orderlines().length === 0) {
                 this.gui.show_popup('error',{
	                'title': _t('Empty Order'),
	                'body':  _t('There must be at least one product sale in your order before it can be validated'),
	            });
	        }

            // process check payment lines.
	        var plines = order.get_paymentlines();
	        for (var i = 0; i < plines.length; i++) {
	            if (plines[i].get_type() === 'bank' && plines[i].get_amount() < 0) {
	                this.lounge_widget.screen_selector.show_popup('error',{
	                    'message': _t('Negative Bank Payment'),
	                    'comment': _t('You cannot have a negative amount in a Bank payment. Use a cash payment method to return money to the customer.'),
	                });
	                return;
	            }
	        }

	        //check order is paid or not
	        if (!order.is_paid() || this.invoicing) {
	            return;
	        }

	         // The exact amount must be paid if there is no cash payment method defined.
	        if (Math.abs(order.get_total_with_tax() - order.get_total_paid()) > 0.00001) {
	            var cash = false;
	            for (var i = 0; i < this.lounge.cashregisters.length; i++) {
	                cash = cash || (this.lounge.cashregisters[i].journal.type === 'cash');
	            }
	            if (!cash) {
	                this.gui.show_popup('error',{
	                    title: _t('Cannot return change without a cash payment method'),
	                    body:  _t('There is no cash payment method available in this point of sale to handle the change.\n\n Please pay the exact amount or add a cash payment method in the point of sale configuration'),
	                });
	                return;
	            }
	        }

	        // if the change is too large, it's probably an input error, make the user confirm.
	        if (!force_validation && (order.get_total_with_tax() * 1000 < order.get_total_paid())) {
	            this.gui.show_popup('confirm',{
	                title: _t('Please Confirm Large Amount'),
	                body:  _t('Are you sure that the customer wants to  pay') +
	                       ' ' +
	                       this.format_currency(order.get_total_paid()) +
	                       ' ' +
	                       _t('for an order of') +
	                       ' ' +
	                       this.format_currency(order.get_total_with_tax()) +
	                       ' ' +
	                       _t('? Clicking "Confirm" will validate the payment.'),
	                confirm: function() {
	                    self.validate_order('confirm');
	                },
	            });
	            return;
	        }

            // if the order cash with cashdrawer.
	        if(order.is_paid_with_cash() && this.lounge.config.iface_cashdrawer) {
	            this.lounge.proxy.open_cashbox();
	        }

	        order.initialize_validation_date();

	        this.lounge.push_order(order);
	        this.gui.show_screen('order_receipt');

	    },
	    show: function(){
	        this.lounge.get_order().clean_empty_paymentlines();
	        this.reset_input();
	        this.render_paymentlines();
	        window.document.body.addEventListener('keypress',this.keyboard_handler);
	        window.document.body.addEventListener('keydown',this.keyboard_keydown_handler);
	        this._super();
	    },
	    hide: function(){
	        window.document.body.removeEventListener('keypress',this.keyboard_handler);
	        window.document.body.removeEventListener('keydown',this.keyboard_keydown_handler);
	        this._super();
	    },
    });
    gui.define_screen({name:'order_payment', widget: OrderPaymentScreenWidget});

    /*--------------------------------------*\
	 | THE LAST ORDER RECEIPT SCREEN/FINISH  |
	\*======================================*/
	// The receipt screen displays the order's
	// receipt and allows it to be printed in a web browser.
	// The receipt screen is not shown if the point of lounge
	// is set up to print with the proxy. Altough it could
	// be useful to do so...
	var OrderReceiptScreenWidget = ScreenWidget.extend({
	    template: 'LoungeOrderReceiptScreenWidget',
	    show: function() {
	        this._super();
	        var self = this;
	        this.render_change();
	        this.render_receipt();

	        if (this.should_auto_print()) {
	            this.print();
	            if (this.should_close_immediately()){
	                this.click_next();
	            }
	        } else {
	            this.lock_screen(false);
	        }

	    },
	    render_change: function() {
	        this.$('.change-value').html(this.format_currency(this.lounge.get_order().get_change()));
	    },
	    render_receipt: function() {
	        var order = this.lounge.get_order();
	        this.$('.pos-receipt-container').html(QWeb.render('LoungePosTicket',{
	             widget:this,
	             order: order,
	             receipt: order.export_for_printing(),
	             orderlines: order.get_orderlines(),
	             paymentlines: order.get_paymentlines(),
	        }));
	    },
	    should_auto_print: function() {
	        return this.lounge.config.iface_print_auto && !this.lounge.get_order()._printed;
	    },
	    print: function() {
	        var self = this;

	        if (!this.lounge.config.iface_print_via_proxy) { // browser (html) printing
	            this.lock_screen(true);
	             setTimeout(function(){
	                self.lock_screen(false);
	            }, 1000);
	            this.print_web();
	        } else {
	            this.print_xml();
	            this.lock_screen(false);
	        }
	    },
	    lock_screen: function(locked) {
	        this._locked = locked;
	        if (locked) {
	            this.$('.next').removeClass('highlight');
	        } else {
	            this.$('.next').addClass('highlight');
	        }
	    },
	    print_web: function() {
	        window.print();
	        this.lounge.get_order()._printed = true;
	    },
	    print_xml: function() {
	         var env = {
	            widget:  this,
	            lounge:  this.lounge,
	            order:   this.lounge.get_order(),
	            receipt: this.lounge.get_order().export_for_printing(),
	            paymentlines: this.lounge.get_order().get_paymentlines()
	        };

	        var receipt = QWeb.render('LoungeOrderXmlReceipt',env);
	        this.lounge.proxy.print_receipt(receipt);
	        this.lounge.get_order()._printed = true;
	    },
	    should_close_immediately: function() {
	        return this.lounge.config.iface_print_via_proxy && this.lounge.config.iface_print_skip_screen;
	    },
	    click_next: function() {
	        this.lounge.get_order().finalize();
	    },
	    click_back: function() {
	        // Placeholder method for ReceiptScreen extensions that
	        // can go back ...
	    },
	    renderElement: function() {
	        var self = this;
	        this._super();

	        this.$('.next').click(function(){
	            if (!self._locked) {
	                self.click_next();
	            }
	        });

	        this.$('.back').click(function(){
	            if (!self._locked) {
	                self.click_back();
	            }
	        });

	        this.$('.button.print').click(function(){
	            if (!self._locked) {
	                self.print();
	            }
	        });
	    }
	});
	gui.define_screen({name:'order_receipt', widget: OrderReceiptScreenWidget});

	var set_fiscal_position_button = ActionButtonWidget.extend({
	    template: 'LoungeSetFiscalPositionButton',
	    button_click: function () {
	        var self = this;
	        var selection_list = _.map(self.lounge.fiscal_positions, function (fiscal_position) {
	            return {
	                label: fiscal_position.name,
	                item: fiscal_position
	            };
	        });
	        self.gui.show_popup('selection',{
	            title: _t('Select tax'),
	            list: selection_list,
	            confirm: function (fiscal_position) {
	                var order = self.lounge.get_order();
	                order.fiscal_position = fiscal_position;
	                order.trigger('change');
	            }
	        });
	    },
	});

	define_action_button({
	    'name': 'set_fiscal_position',
	    'widget': set_fiscal_position_button,
	    'condition': function(){
	        return this.lounge.fiscal_positions.length > 0;
	    },
	});

	return {
	    ReceiptScreenWidget: ReceiptScreenWidget,
	    ActionButtonWidget: ActionButtonWidget,
	    define_action_button: define_action_button,
	    ScreenWidget: ScreenWidget,
	    PaymentScreenWidget: PaymentScreenWidget,
	    OrderWidget: OrderWidget,
	    NumpadWidget: NumpadWidget,
	    ProductScreenWidget: ProductScreenWidget,
	    ProductListWidget: ProductListWidget,
	    ClientListScreenWidget: ClientListScreenWidget,
	    ActionflightWidget: ActionflightWidget,
	    ActiontimeWidget: ActiontimeWidget,
	    ActioncheckoutWidget: ActioncheckoutWidget,
	    ActionpadWidget: ActionpadWidget,
	    OrderListScreenWidget: OrderListScreenWidget,
	    OrderPaymentScreenWidget: OrderPaymentScreenWidget,
	    OrderReceiptScreenWidget: OrderReceiptScreenWidget,
	    DomCache: DomCache,
	    ProductCategoriesWidget: ProductCategoriesWidget,
	    ScaleScreenWidget: ScaleScreenWidget,
	    set_fiscal_position_button: set_fiscal_position_button,
	};

});

