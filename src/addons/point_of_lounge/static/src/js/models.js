odoo.define('point_of_lounge.models', function (require) {
	"use strict";

	var BarcodeParser = require('barcodes.BarcodeParser');
	var LoungeDB = require('point_of_lounge.DB');
	var devices = require('point_of_lounge.devices');
	var core = require('web.core');
	var Model = require('web.DataModel');
	var formats = require('web.formats');
	var session = require('web.session');
	var time = require('web.time');
	var utils = require('web.utils');

	var QWeb = core.qweb;
	var _t = core._t;
	var Mutex = utils.Mutex;
	var round_di = utils.round_decimals;
	var round_pr = utils.round_precision;
	var Backbone = window.Backbone;

	var exports = {};

	// The PosModel contains Lounge representation of the backend.
	// Since the PoS must work in standalone ( Without connection to the server )
	// it must contains a representation of the server's PoS backend.
	// (taxes, product list, configuration options, etc.)  this representation
	// is fetched and stored by the PosModel at the initialisation.
	// this is done asynchronously, a ready deferred alows the GUI to wait interactively
	// for the loading to be completed
	// There is a single instance of the PosModel for each Front-End instance, it is usually called
	// 'lounge' and is available to all widgets extending PosWidget.

	exports.LoungeModel = Backbone.Model.extend({
	    initialize: function(session, attributes) {
	        Backbone.Model.prototype.initialize.call(this, attributes);
	        var  self = this;
	        this.flush_mutex = new Mutex();                   // used to make sure the orders are sent to the server once at time
	        this.chrome = attributes.chrome;
	        this.gui    = attributes.gui;

	        this.proxy = new devices.ProxyDevice(this);              // used to communicate to the hardware devices via a local proxy
	        this.barcode_reader = new devices.BarcodeReader({'lounge': this, proxy:this.proxy});

	        this.proxy_queue = new devices.JobQueue();           // used to prevent parallels communications to the proxy
	        this.db = new LoungeDB();                       // a local database used to search trough products and categories & store pending orders
	        this.debug = core.debug; //debug mode

	        // Business data; loaded from the server at launch
	        this.company_logo = null;
	        this.remove_order_id = 0;
	        this.company_logo_base64 = '';
	        this.currency = null;
	        this.shop = null;
	        this.company = null;
	        this.user = null;
	        this.users = [];
	        this.partners = [];
	        this.checkout_orders = []; //last checkout_order
	        this.orders = []; //last order
	        this.cashier = null;
	        this.cashregisters = [];
	        this.taxes = [];
	        this.lounge_session = null;
	        this.config = null;
	        this.units = [];
	        this.units_by_id = {};
	        this.pricelist = null;
	        this.order_sequence = 1;
	        window.loungemodel = this;

	        // these dynamic attributes can be watched for change by other models or widgets
	        this.set({
	            'synch':            { state:'connected', pending:0 },
	            'orders':           new OrderCollection(),
	            'checkout_orders':  new CheckoutOrderCollection(),
	            'selectedOrder':    null,
	            'selectedCheckoutOrder': null,
	            'selectedClient':   null,
	            'selectedPaymentMethod':   null,
	            'selectedCheckoutClient' : null,
	        });

	        this.get('orders').bind('remove', function(order,_unused_,options){
	            self.on_removed_order(order,options.index,options.reason);
	        });

	        this.get('checkout_orders').bind('remove', function(checkout_order,_unused_,options){
	            self.on_removed_checkout_order(checkout_order,options.index,options.reason);
	        });

	        // Forward the 'client' attribute on the selected order to 'selectedClient'
	        function update_client() {
	            var order = self.get_order();
	            this.set('selectedClient', order ? order.get_client() : null );
	        }
	        //this.get('orders').bind('add remove change', update_client, this);
	        //this.bind('change:selectedOrder', update_client, this);

	        // Forward the 'client' attribute on the selected order to 'selectedClient'
	        function update_payment_method() {
	            var order = self.get_order();
	            this.set('selectedPaymentMethod', order ? order.get_payment_method() : null );
	        }

	        // Forward the 'client' attribute on the selected order to 'selectedClient'
	        function update_checkout_client() {
	            var checkout_order = self.get_checkout_order();
	            this.set('selectedCheckoutClient', checkout_order ? checkout_order.get_client() : null );
	        }

	        this.get('orders').bind('add remove change', update_client, this);
	        this.get('orders').bind('add remove change', update_payment_method, this);
	        this.get('checkout_orders').bind('add remove change', update_checkout_client, this);

	        this.bind('change:selectedOrder', update_client, this);
	        this.bind('change:selectedOrder', update_payment_method, this);
	        this.bind('change:selectedCheckoutOrder', update_checkout_client, this);


	        // We fetch the backend data on the server asynchronously. this is done only when the pos user interface is launched,
	        // Any change on this data made on the server is thus not reflected on the lounge  until it is relaunched.
	        // when all the data has loaded, we compute some stuff, and declare the Lounge ready to be used.
	        this.ready = this.load_server_data().then(function() {
	            return self.after_load_server_data();
	        });
	    },
	    after_load_server_data: function(){
	         this.load_orders();
	         this.load_checkout_orders();
	         this.set_start_order();
	         this.set_start_checkout_order();
	         if(this.config.use_proxy){
	             return this.connect_to_proxy();
	         }
	    },
	    // releases ressources holds by the model at the end of life of the posmodel
	    destroy: function(){
	        // FIXME, should wait for flushing, return a deferred to indicate successfull destruction
	        // this.flush();
	        this.proxy.close();
	        this.barcode_reader.disconnect();
	        this.barcode_reader.disconnect_from_proxy();
	    },

	    connect_to_proxy: function(){
	        var self = this;
	        var  done = new $.Deferred();
	        this.barcode_reader.disconnect_from_proxy();
	        this.chrome.loading_message(_t('Connecting to the PosBox'),0);
	        this.chrome.loading_skip(function(){
	                self.proxy.stop_searching();
	            });
	        this.proxy.autoconnect({
	                force_ip: self.config.proxy_ip || undefined,
	                progress: function(prog){
	                    self.chrome.loading_progress(prog);
	                },
	            }).then(function(){
	                if(self.config.iface_scan_via_proxy){
	                    self.barcode_reader.connect_to_proxy();
	                }
	            }).always(function(){
	                done.resolve();
	            });
	        return done;
	    },

	    // Server side model loaders. This is the list of the models that need to be loaded from
	    // the server. The models are loaded one by one by this list's order. The 'loaded' callback
	    // is used to store the data in the appropriate place once it has been loaded. This callback
	    // can return a deferred that will pause the loading of the next module.
	    // a shared temporary dictionary is available for loaders to communicate private variables
	    // used during loading such as object ids, etc.
	    models: [
	    {
	        label:  'version',
	        loaded: function(self){
	            return session.rpc('/web/webclient/version_info',{}).done(function(version) {
	                self.version = version;
	            });
	        },

	    },{
	        model:  'res.users',
	        fields: ['name','company_id'],
	        ids:    function(self){ return [session.uid]; },
	        loaded: function(self,users){ self.user = users[0]; },
	    },{
	        model:  'res.company',
	        fields: [ 'currency_id', 'email', 'website', 'company_registry', 'vat', 'name', 'phone', 'partner_id' , 'country_id', 'tax_calculation_rounding_method'],
	        ids:    function(self){ return [self.user.company_id[0]]; },
	        loaded: function(self,companies){ self.company = companies[0]; },
	    },{
	        model:  'decimal.precision',
	        fields: ['name','digits'],
	        loaded: function(self,dps){
	            self.dp  = {};
	            for (var i = 0; i < dps.length; i++) {
	                self.dp[dps[i].name] = dps[i].digits;
	            }
	        },
	    },{
	        model:  'product.uom',
	        fields: [],
	        domain: null,
	        context: function(self){ return { active_test: false }; },
	        loaded: function(self,units){
	            self.units = units;
	            var units_by_id = {};
	            for(var i = 0, len = units.length; i < len; i++){
	                units_by_id[units[i].id] = units[i];
	                units[i].groupable = ( units[i].category_id[0] === 1 );
	                units[i].is_unit   = ( units[i].id === 1 );
	            }
	            self.units_by_id = units_by_id;
	        }
	    },{
	        model:  'lounge.order',
	        fields: ['name','lounge_reference','date_order','booking_from_date','booking_to_date','flight_type','flight_number','partner_id','payment_method_id','company_type','total_pax','amount_total','amount_paid','write_date'],
	        domain: [['is_checkout','=',false]],
	        loaded: function(self,orders){
	            self.orders = orders;
	            self.db.add_orders(orders);
	        },
	    },{
	        model:  'lounge.order.line',
	        fields: ['name','lounge_reference','order_id','product_id','lounge_charge','lounge_charge_every','qty','charge','discount','price_unit','price_subtotal_incl','write_date'],
	        domain: [['order_id.is_checkout','=',false]],
	        loaded: function(self,lines){
	            self.lines = lines;
	            self.db.add_order_lines(lines);
	        },
	    },{
	        model:  'res.partner',
	        fields: ['name','street','city','state_id','country_id','vat','phone','zip','mobile','pic','company_type','email','lounge_barcode','disc_product','write_date'],
	        domain: [['customer','=',true]],
	        loaded: function(self,partners){
	            self.partners = partners;
	            self.db.add_partners(partners);
	        },
	    },{
	        model:  'res.country',
	        fields: ['name'],
	        loaded: function(self,countries){
	            self.countries = countries;
	            self.company.country = null;
	            for (var i = 0; i < countries.length; i++) {
	                if (countries[i].id === self.company.country_id[0]){
	                    self.company.country = countries[i];
	                }
	            }
	        },
	    },{
	        model:  'account.tax',
	        fields: ['name','amount', 'price_include', 'include_base_amount', 'amount_type', 'children_tax_ids'],
	        domain: null,
	        loaded: function(self, taxes){
	            self.taxes = taxes;
	            self.taxes_by_id = {};
	            _.each(taxes, function(tax){
	                self.taxes_by_id[tax.id] = tax;
	            });
	            _.each(self.taxes_by_id, function(tax) {
	                tax.children_tax_ids = _.map(tax.children_tax_ids, function (child_tax_id) {
	                    return self.taxes_by_id[child_tax_id];
	                });
	            });
	        },
	    },{
	        model:  'lounge.session',
	        fields: ['id', 'journal_ids','name','user_id','config_id','start_at','stop_at','sequence_number','login_number'],
	        domain: function(self){ return [['state','=','opened'],['user_id','=',session.uid]]; },
	        loaded: function(self,lounge_sessions){
	            self.lounge_session = lounge_sessions[0];
	        },
	    },{
	        model: 'lounge.config',
	        fields: [],
	        domain: function(self){ return [['id','=', self.lounge_session.config_id[0]]]; },
	        loaded: function(self,configs){
	            self.config = configs[0];
	            self.config.use_proxy = self.config.iface_payment_terminal ||
	                                    self.config.iface_electronic_scale ||
	                                    self.config.iface_print_via_proxy  ||
	                                    self.config.iface_scan_via_proxy   ||
	                                    self.config.iface_cashdrawer;

	            if (self.config.company_id[0] !== self.user.company_id[0]) {
	                throw new Error(_t("Error: The Longe User must belong to the same company as the Point of Lounge. You are probably trying to load the point of sale as an administrator in a multi-company setup, with the administrator account set to the wrong company."));
	            }

	            self.db.set_uuid(self.config.uuid);

	            var orders = self.db.get_orders();
	            for (var i = 0; i < orders.length; i++) {
	                self.lounge_session.sequence_number = Math.max(self.lounge_session.sequence_number, orders[i].data.sequence_number+1);
	            }
	       },
	    },{
	        model:  'res.users',
	        fields: ['name','lounge_security_pin','groups_id','barcode'],
	        domain: function(self){ return [['company_id','=',self.user.company_id[0]],'|', ['groups_id','=', self.config.group_lounge_manager_id[0]],['groups_id','=', self.config.group_lounge_user_id[0]]]; },
	        loaded: function(self,users){
	            // we attribute a role to the user, 'cashier' or 'manager', depending
	            // on the group the user belongs.
	            var lounge_users = [];
	            for (var i = 0; i < users.length; i++) {
	                var user = users[i];
	                for (var j = 0; j < user.groups_id.length; j++) {
	                    var group_id = user.groups_id[j];
	                    if (group_id === self.config.group_lounge_manager_id[0]) {
	                        user.role = 'manager';
	                        break;
	                    } else if (group_id === self.config.group_lounge_user_id[0]) {
	                        user.role = 'cashier';
	                    }
	                }
	                if (user.role) {
	                    lounge_users.push(user);
	                }
	                // replace the current user with its updated version
	                if (user.id === self.user.id) {
	                    self.user = user;
	                }
	            }
	            self.users = lounge_users;
	        },
	    },{
	        model: 'stock.location',
	        fields: [],
	        ids:    function(self){ return [self.config.stock_location_id[0]]; },
	        loaded: function(self, locations){ self.shop = locations[0]; },
	    },{
	        model:  'product.pricelist',
	        fields: ['currency_id'],
	        ids:    function(self){ return [self.config.pricelist_id[0]]; },
	        loaded: function(self, pricelists){ self.pricelist = pricelists[0]; },
	    },{
	        model: 'res.currency',
	        fields: ['name','symbol','position','rounding'],
	        ids:    function(self){ return [self.pricelist.currency_id[0]]; },
	        loaded: function(self, currencies){
	            self.currency = currencies[0];
	            if (self.currency.rounding > 0) {
	                self.currency.decimals = Math.ceil(Math.log(1.0 / self.currency.rounding) / Math.log(10));
	            } else {
	                self.currency.decimals = 0;
	            }

	        },
	    },{
	        model: 'product.packaging',
	        fields: ['barcode','product_tmpl_id'],
	        domain: null,
	        loaded: function(self, packagings){
	            self.db.add_packagings(packagings);
	        },
	    },{
	        model:  'lounge.category',
	        fields: ['id','name','parent_id','child_id','image'],
	        domain: null,
	        loaded: function(self, categories){
	            self.db.add_categories(categories);
	        },
	    },{
	        model:  'product.product',
	        fields: ['display_name', 'list_price','price','lounge_categ_id', 'taxes_id', 'barcode', 'default_code',
	                 'to_weight', 'uom_id', 'description_sale', 'description','lounge_charge','is_disc_company','lounge_charge_every',
	                 'product_tmpl_id'],
	        order:  ['sequence','default_code','name'],
	        domain: [['sale_ok','=',true],['available_in_lounge','=',true]],
	        context: function(self){ return { pricelist: self.pricelist.id, display_default_code: false }; },
	        loaded: function(self, products){
	            self.db.add_products(products);
	        },
	    },{
	        model:  'account.bank.statement',
	        fields: ['lounge_account_id','currency_id','journal_id','state','name','user_id','lounge_session_id'],
	        domain: function(self){ return [['state', '=', 'open'],['lounge_session_id', '=', self.lounge_session.id]]; },
	        loaded: function(self, cashregisters, tmp){
	            self.cashregisters = cashregisters;

	            tmp.journals = [];
	            _.each(cashregisters,function(statement){
	                tmp.journals.push(statement.journal_id[0]);
	            });
	        },
	    },{
	        model:  'account.journal',
	        fields: ['type', 'sequence','name','journal_change_amount','amount_fixed_price','max_pax'],
	        domain: function(self,tmp){ return [['id','in',tmp.journals]]; },
	        loaded: function(self, journals){
	            var i;
	            self.journals = journals;

	            // associate the bank statements with their journals.
	            var cashregisters = self.cashregisters;
	            var ilen = cashregisters.length;
	            for(i = 0; i < ilen; i++){
	                for(var j = 0, jlen = journals.length; j < jlen; j++){
	                    if(cashregisters[i].journal_id[0] === journals[j].id) {
	                        cashregisters[i].journal = journals[j];
	                    }
	                }
	            }

	            self.cashregisters_by_id = {};
	            for (i = 0; i < self.cashregisters.length; i++) {
	                self.cashregisters_by_id[self.cashregisters[i].id] = self.cashregisters[i];
	            }

	            self.cashregisters = self.cashregisters.sort(function(a,b){
			// prefer cashregisters to be first in the list
			if (a.journal.type == "cash" && b.journal.type != "cash") {
			    return -1;
			} else if (a.journal.type != "cash" && b.journal.type == "cash") {
			    return 1;
			} else {
	                    return a.journal.sequence - b.journal.sequence;
			}
	            });

	        },
	    },  {
	        model:  'account.fiscal.position',
	        fields: [],
	        domain: function(self){ return [['id','in',self.config.fiscal_position_ids]]; },
	        loaded: function(self, fiscal_positions){
	            self.fiscal_positions = fiscal_positions;
	        }
	    }, {
	        model:  'account.fiscal.position.tax',
	        fields: [],
	        domain: function(self){
	            var fiscal_position_tax_ids = [];

	            self.fiscal_positions.forEach(function (fiscal_position) {
	                fiscal_position.tax_ids.forEach(function (tax_id) {
	                    fiscal_position_tax_ids.push(tax_id);
	                });
	            });

	            return [['id','in',fiscal_position_tax_ids]];
	        },
	        loaded: function(self, fiscal_position_taxes){
	            self.fiscal_position_taxes = fiscal_position_taxes;
	            self.fiscal_positions.forEach(function (fiscal_position) {
	                fiscal_position.fiscal_position_taxes_by_id = {};
	                fiscal_position.tax_ids.forEach(function (tax_id) {
	                    var fiscal_position_tax = _.find(fiscal_position_taxes, function (fiscal_position_tax) {
	                        return fiscal_position_tax.id === tax_id;
	                    });

	                    fiscal_position.fiscal_position_taxes_by_id[fiscal_position_tax.id] = fiscal_position_tax;
	                });
	            });
	        }
	    },  {
	        label: 'fonts',
	        loaded: function(){
	            var fonts_loaded = new $.Deferred();
	            // Waiting for fonts to be loaded to prevent receipt printing
	            // from printing empty receipt while loading Inconsolata
	            // ( The font used for the receipt )
	            waitForWebfonts(['Lato','Inconsolata'], function(){
	                fonts_loaded.resolve();
	            });
	            // The JS used to detect font loading is not 100% robust, so
	            // do not wait more than 5sec
	            setTimeout(function(){
	                fonts_loaded.resolve();
	            },5000);

	            return fonts_loaded;
	        },
	    },{
	        label: 'pictures',
	        loaded: function(self){
	            self.company_logo = new Image();
	            var  logo_loaded = new $.Deferred();
	            self.company_logo.onload = function(){
	                var img = self.company_logo;
	                var ratio = 1;
	                var targetwidth = 300;
	                var maxheight = 150;
	                if( img.width !== targetwidth ){
	                    ratio = targetwidth / img.width;
	                }
	                if( img.height * ratio > maxheight ){
	                    ratio = maxheight / img.height;
	                }
	                var width  = Math.floor(img.width * ratio);
	                var height = Math.floor(img.height * ratio);
	                var c = document.createElement('canvas');
	                    c.width  = width;
	                    c.height = height;
	                var ctx = c.getContext('2d');
	                    ctx.drawImage(self.company_logo,0,0, width, height);

	                self.company_logo_base64 = c.toDataURL();
	                logo_loaded.resolve();
	            };
	            self.company_logo.onerror = function(){
	                logo_loaded.reject();
	            };
	            self.company_logo.crossOrigin = "anonymous";
	            self.company_logo.src = '/web/binary/company_logo' +'?dbname=' + session.db + '&_'+Math.random();

	            return logo_loaded;
	        },
	    }, {
	        label: 'barcodes',
	        loaded: function(self) {
	            var barcode_parser = new BarcodeParser({'nomenclature_id': self.config.barcode_nomenclature_id});
	            self.barcode_reader.set_barcode_parser(barcode_parser);
	            return barcode_parser.is_loaded();
	        },
	    }
	    ],

	    // loads all the needed data on the sever. returns a deferred indicating when all the data has loaded.
	    load_server_data: function(){
	        var self = this;
	        var loaded = new $.Deferred();
	        var progress = 0;
	        var progress_step = 1.0 / self.models.length;
	        var tmp = {}; // this is used to share a temporary state between models loaders

	        function load_model(index){
	            if(index >= self.models.length){
	                loaded.resolve();
	            }else{
	                var model = self.models[index];
	                self.chrome.loading_message(_t('Loading')+' '+(model.label || model.model || ''), progress);

	                var cond = typeof model.condition === 'function'  ? model.condition(self,tmp) : true;
	                if (!cond) {
	                    load_model(index+1);
	                    return;
	                }

	                var fields =  typeof model.fields === 'function'  ? model.fields(self,tmp)  : model.fields;
	                var domain =  typeof model.domain === 'function'  ? model.domain(self,tmp)  : model.domain;
	                var context = typeof model.context === 'function' ? model.context(self,tmp) : model.context;
	                var ids     = typeof model.ids === 'function'     ? model.ids(self,tmp) : model.ids;
	                var order   = typeof model.order === 'function'   ? model.order(self,tmp):    model.order;
	                progress += progress_step;

	                var records;
	                if( model.model ){
	                    if (model.ids) {
	                        records = new Model(model.model).call('read',[ids,fields],context);
	                    } else {
	                        records = new Model(model.model)
	                            .query(fields)
	                            .filter(domain)
	                            .order_by(order)
	                            .context(context)
	                            .all();
	                    }
	                    records.then(function(result){
	                            try{    // catching exceptions in model.loaded(...)
	                                $.when(model.loaded(self,result,tmp))
	                                    .then(function(){ load_model(index + 1); },
	                                          function(err){ loaded.reject(err); });
	                            }catch(err){
	                                console.error(err.stack);
	                                loaded.reject(err);
	                            }
	                        },function(err){
	                            loaded.reject(err);
	                        });
	                }else if( model.loaded ){
	                    try{    // catching exceptions in model.loaded(...)
	                        $.when(model.loaded(self,tmp))
	                            .then(  function(){ load_model(index +1); },
	                                    function(err){ loaded.reject(err); });
	                    }catch(err){
	                        loaded.reject(err);
	                    }
	                }else{
	                    load_model(index + 1);
	                }
	            }
	        }

	        try{
	            load_model(0);
	        }catch(err){
	            loaded.reject(err);
	        }

	        return loaded;
	    },

	    // reload the list of partner, returns as a deferred that resolves if there were
	    // updated partners, and fails if not
	    load_new_partners: function(){
	        var self = this;
	        var def  = new $.Deferred();
	        var fields = _.find(this.models,function(model){ return model.model === 'res.partner'; }).fields;
	        new Model('res.partner')
	            .query(fields)
	            .filter([['customer','=',true],['write_date','>',this.db.get_partner_write_date()]])
	            .all({'timeout':3000, 'shadow': true})
	            .then(function(partners){
	                if (self.db.add_partners(partners)) {   // check if the partners we got were real updates
	                    def.resolve();
	                } else {
	                    def.reject();
	                }
	            }, function(err,event){ event.preventDefault(); def.reject(); });
	        return def;
	    },

	    // reload the list of order, returns as a deferred that resolves if there were
	    // updated orders, and fails if not
	    load_new_orders: function(){
	        var self = this;
	        var def  = new $.Deferred();
	        var fields = _.find(this.models,function(model){ return model.model === 'lounge.order'; }).fields;
	        new Model('lounge.order')
	            .query(fields)
	            .filter([['is_checkout','=',false]])
	            .all({'timeout':3000, 'shadow': true})
	            .then(function(orders){
	                if (self.db.add_orders(orders)) {   // check if the orders we got were real updates
	                    def.resolve();
	                } else {
	                    def.reject();
	                }
	            }, function(err,event){ event.preventDefault(); def.reject(); });
	        return def;
	    },

	    // reload the list of order, returns as a deferred that resolves if there were
	    // updated orders, and fails if not
	    load_new_order_lines: function(){
	        var self = this;
	        var def  = new $.Deferred();
	        var fields = _.find(this.models,function(model){ return model.model === 'lounge.order.line'; }).fields;
	        new Model('lounge.order.line')
	            .query(fields)
	            .filter([['order_id.is_checkout','=',false]])
	            .all({'timeout':3000, 'shadow': true})
	            .then(function(order_lines){
	                if (self.db.add_order_lines(order_lines)) {   // check if the orders we got were real updates
	                    def.resolve();
	                } else {
	                    def.reject();
	                }
	            }, function(err,event){ event.preventDefault(); def.reject(); });
	        return def;
	    },

	    // this is called when an order is removed from the order collection. It ensures that there is always an existing
	    // order and a valid selected order
	    on_removed_order: function(removed_order,index,reason){
	        var order_list = this.get_order_list();
	        if( (reason === 'abandon' || removed_order.temporary) && order_list.length > 0){
	            // when we intentionally remove an unfinished order, and there is another existing one
	            this.set_order(order_list[index] || order_list[order_list.length -1]);
	        }else{
	            // when the order was automatically removed after completion,
	            // or when we intentionally delete the only concurrent order
	            this.add_new_order();
	        }
	    },

	    // this is called when an order is removed from the order collection. It ensures that there is always an existing
	    // order and a valid selected order
	    on_removed_checkout_order: function(removed_checkout_order,index,reason){
	        var checkout_order_list = this.get_checkout_order_list();
	        if( (reason === 'abandon' || removed_checkout_order.temporary) && checkout_order_list.length > 0){
	            // when we intentionally remove an unfinished order, and there is another existing one
	            this.set_checkout_order(checkout_order_list[index] || checkout_order_list[checkout_order_list.length -1]);
	        }else{
	            // when the order was automatically removed after completion,
	            // or when we intentionally delete the only concurrent order
	            this.add_new_checkout_order();
	        }
	    },

	    // returns the user who is currently the cashier for this point of sale
	    get_cashier: function(){
	        return this.cashier || this.user;
	    },
	    // changes the current cashier
	    set_cashier: function(user){
	        this.cashier = user;
	    },
	    //creates a new empty order and sets it as the current order
	    add_new_order: function(){
	        var order = new exports.Order({},{lounge:this});
	        this.get('orders').add(order);
	        this.set('selectedOrder', order);
	        return order;
	    },
	    add_new_checkout_order: function(){
	        var checkout_order = new exports.CheckoutOrder({},{lounge:this});
	        this.get('checkout_orders').add(checkout_order);
	        this.set('selectedCheckoutOrder', checkout_order);
	        return checkout_order;
	    },
	    // load the locally saved unpaid orders for this session.
	    load_orders: function(){
	        var jsons = this.db.get_unpaid_orders();
	        var orders = [];
	        var not_loaded_count = 0;

	        for (var i = 0; i < jsons.length; i++) {
	            var json = jsons[i];
	            if (json.lounge_session_id === this.lounge_session.id) {
	                orders.push(new exports.Order({},{
	                    lounge:  this,
	                    json: json,
	                }));
	            } else {
	                not_loaded_count += 1;
	            }
	        }

	        if (not_loaded_count) {
	            console.info('There are '+not_loaded_count+' locally saved unpaid orders belonging to another session');
	        }

	        orders = orders.sort(function(a,b){
	            return a.sequence_number - b.sequence_number;
	        });

	        if (orders.length) {
	            this.get('orders').add(orders);
	        }
	    },
	    // load the locally saved unpaid orders for this session.
	    load_checkout_orders: function(){
	        var jsons = this.db.get_unpaid_checkout_orders();
	        var checkout_orders = [];
	        var not_loaded_count = 0;

	        for (var i = 0; i < jsons.length; i++) {
	            var json = jsons[i];
	            if (json.lounge_session_id === this.lounge_session.id) {
	                checkout_orders.push(new exports.CheckoutOrder({},{
	                    lounge:  this,
	                    json: json,
	                }));
	            } else {
	                not_loaded_count += 1;
	            }
	        }

	        if (not_loaded_count) {
	            console.info('There are '+not_loaded_count+' locally saved unpaid orders belonging to another session');
	        }

	        checkout_orders = checkout_orders.sort(function(a,b){
	            return a.sequence_number - b.sequence_number;
	        });

	        if (checkout_orders.length) {
	            this.get('checkout_orders').add(checkout_orders);
	        }
	    },

	    set_start_order: function(){
	        var orders = this.get('orders').models;

	        if (orders.length && !this.get('selectedOrder')) {
	            this.set('selectedOrder',orders[0]);
	        } else {
	            this.add_new_order();
	        }
	    },

	    set_start_checkout_order: function(){
	        var checkout_orders = this.get('checkout_orders').models;

	        if (checkout_orders.length && !this.get('selectedCheckoutOrder')) {
	            this.set('selectedCheckoutOrder',checkout_orders[0]);
	        } else {
	            this.add_new_checkout_order();
	        }
	    },

	    get_diff_hours: function(date_from , date_to) {
	        if(date_from && date_to) {
				//date 01/02/2017 22:00
				var dd_from = date_from.substr(0,2);
				var mm_from = date_from.substr(3,2);
				var yy_from = date_from.substr(6,4);
				var hour_from = date_from.substr(11,5);

				var dd_to = date_to.substr(0,2);
				var mm_to = date_to.substr(3,2);
				var yy_to = date_to.substr(6,4);
				var hour_to = date_to.substr(11,5);

				var dt1 = new Date("" + mm_from + " " + dd_from + ", " + yy_from + " " + hour_from + ":00");
				//dt1.setHours(dt1.getHours() - 7);
				var dt2 = new Date("" + mm_to + " " + dd_to + ", " + yy_to + " " + hour_to + ":00");
				//dt2.setHours(dt2.getHours() - 7);
				var diff =(dt2.getTime() - dt1.getTime()) / 1000;
	            diff /= (60 * 60);
	            return Math.ceil(diff);
            } else {
                return 0;
            }
	    },

	    // return the current order
	    get_order: function(){
	        return this.get('selectedOrder');
	    },

	    // return the current order
	    get_checkout_order: function(){
	        return this.get('selectedCheckoutOrder');
	    },

	    get_client: function() {
	        var order = this.get_order();
	        if (order) {
	            return order.get_client();
	        }
	        return null;
	    },
	    get_payment_method: function() {
	        var order = this.get_order();
	        if (order) {
	            return order.get_payment_method();
	        }
	        return null;
	    },
        get_checkout_client: function() {
	        var checkout_order = this.get_checkout_order();
	        if (checkout_order) {
	            return checkout_order.get_checkout_client();
	        }
	        return null;
	    },

	    get_remove_order_id : function() {
	        return this.remove_order_id;
	    },
	    set_remove_order_id : function(id) {
            return this.remove_order_id = id;
	    },
	    get_flight_type: function() {
	        var order = this.get_order();
	        if (order) {
	            return order.get_flight_type();
	        }
	        return null;
	    },
	    get_flight_number: function() {
	        var order = this.get_order();
	        if (order) {
	            return order.get_flight_number();
	        }
	        return null;
	    },

	    get_booking_from_date: function() {
	        var order = this.get_order();
	        if (order) {
	            return order.get_booking_from_date();
	        }
	        return null;
	    },

	    get_booking_to_date: function() {
	        var order = this.get_order();
	        if (order) {
	            return order.get_booking_to_date();
	        }
	        return null;
	    },

	    /*get_diff_hours: function(date_from,date_to) {
	        var order = this.get_order();
	        if (order) {
	            return order.get_diff_hours(date_from,date_to);
	        }
	        return null;
	    },*/

	    get_booking_total: function() {
	        var order = this.get_order();
	        if (order) {
	            return order.get_booking_total();
	        }
	        return null;
	    },

	    // change the current order
	    set_order: function(order){
	        this.set({ selectedOrder: order });
	    },

	    // change the current order
	    set_checkout_order: function(checkout_order){
	        this.set({ selectedCheckoutOrder: checkout_order });
	    },

	    // return the list of unpaid orders
	    get_order_list: function(){
	        return this.get('orders').models;
	    },

	    // return the list of unpaid orders
	    get_checkout_order_list: function(){
	        return this.get('checkout_orders').models;
	    },

	    //removes the current order
	    delete_current_order: function(){
	        var order = this.get_order();
	        if (order) {
	            order.destroy({'reason':'abandon'});
	        }
	    },

	    //removes the current order
	    delete_current_checkout_order: function(){
	        var checkout_order = this.get_checkout_order();
	        if (checkout_order) {
	            checkout_order.destroy({'reason':'abandon'});
	        }
	    },

	    // saves the order locally and try to send it to the backend.
	    // it returns a deferred that succeeds after having tried to send the order and all the other pending orders.
	    push_order: function(order, opts) {
	        opts = opts || {};
	        var self = this;

	        if(order){
	            this.db.add_order(order.export_as_JSON());
	        }

	        var pushed = new $.Deferred();

	        this.flush_mutex.exec(function(){
	            var flushed = self._flush_orders(self.db.get_orders(), opts);

	            flushed.always(function(ids){
	                pushed.resolve();
	            });
	        });
	        return pushed;
	    },

	    // saves the order locally and try to send it to the backend.
	    // it returns a deferred that succeeds after having tried to send the order and all the other pending orders.
	    push_checkout_order: function(checkout_order, opts) {
	        opts = opts || {};
	        var self = this;

	        if(checkout_order){
	            this.db.remove_orders(checkout_order.get_order_id());
	            this.db.add_checkout_order(checkout_order.export_as_JSON());
	        }

	        var pushed = new $.Deferred();

	        this.flush_mutex.exec(function(){
	            var flushed = self._flush_checkout_orders(self.db.get_checkout_orders(), opts);

	            flushed.always(function(ids){
	                pushed.resolve();
	            });
	        });
	        return pushed;
	    },

	    // saves the order locally and try to send it to the backend.
	    // it returns a deferred that succeeds after having tried to send the order and all the other pending orders.
	    push_non_charge_checkout_order: function(checkout_order, opts) {
	        opts = opts || {};
	        var self = this;

	        if(checkout_order){
	            this.db.remove_orders(checkout_order.get_order_id());
	            this.db.add_checkout_order(checkout_order.export_as_JSON());
	        }

	        var pushed = new $.Deferred();

	        this.flush_mutex.exec(function(){
	            var flushed = self._flush_non_charge_checkout_orders(self.db.get_checkout_orders(), opts);

	            flushed.always(function(ids){
	                pushed.resolve();
	            });
	        });
	        return pushed;
	    },

	    // saves the order locally and try to send it to the backend and make an invoice
	    // returns a deferred that succeeds when the order has been save and successfully generated
	    // an invoice. This method can fail in various ways:
	    // error-no-client: the order must have an associated partner_id. You can retry to make an invoice once
	    //     this error is solved
	    // error-transfer: there was a connection error during the transfer. You can retry to make the invoice once
	    //     the network connection is up

	    push_and_invoice_order: function(order){
	        var self = this;
	        var invoiced = new $.Deferred();

	        if(!order.get_client()){
	            invoiced.reject({code:400, message:'Missing Customer', data:{}});
	            return invoiced;
	        }

	        var order_id = this.db.add_order(order.export_as_JSON());

	        this.flush_mutex.exec(function(){
	            var done = new $.Deferred(); // holds the mutex

	            // send the order to the server
	            // we have a 30 seconds timeout on this push.
	            // FIXME: if the server takes more than 30 seconds to accept the order,
	            // the client will believe it wasn't successfully sent, and very bad
	            // things will happen as a duplicate will be sent next time
	            // so we must make sure the server detects and ignores duplicated orders

	            var transfer = self._flush_orders([self.db.get_order(order_id)], {timeout:30000, to_invoice:true});

	            transfer.fail(function(error){
	                invoiced.reject(error);
	                done.reject();
	            });

	            // on success, get the order id generated by the server
	            transfer.pipe(function(order_server_id){

	                // generate the pdf and download it
	                self.chrome.do_action('point_of_lounge.lounge_invoice_report',{additional_context:{
	                    active_ids:order_server_id,
	                }});

	                invoiced.resolve();
	                done.resolve();
	            });

	            return done;

	        });

	        return invoiced;
	    },
        push_and_invoice_checkout_order: function(checkout_order){
	        var self = this;
	        var invoiced = new $.Deferred();


	        if(!checkout_order.get_client()){
	            invoiced.reject({code:400, message:'Missing Customer', data:{}});
	            return invoiced;
	        }

            //remove db
	        this.db.remove_orders(checkout_order.get_order_id());

	        var checkout_order_id = this.db.add_checkout_order(checkout_order.export_as_JSON());

	        this.flush_mutex.exec(function(){
	            var done = new $.Deferred(); // holds the mutex

	            // send the order to the server
	            // we have a 30 seconds timeout on this push.
	            // FIXME: if the server takes more than 30 seconds to accept the order,
	            // the client will believe it wasn't successfully sent, and very bad
	            // things will happen as a duplicate will be sent next time
	            // so we must make sure the server detects and ignores duplicated orders

	            var transfer = self._flush_checkout_orders([self.db.get_checkout_order(checkout_order_id)], {timeout:30000, to_invoice:true});

	            transfer.fail(function(error){
	                invoiced.reject(error);
	                done.reject();
	            });

	            // on success, get the order id generated by the server
	            transfer.pipe(function(order_checkout_server_id){

	                // generate the pdf and download it
	                self.chrome.do_action('point_of_lounge.lounge_invoice_report',{additional_context:{
	                    active_ids:order_checkout_server_id,
	                }});

	                invoiced.resolve();
	                done.resolve();
	            });

	            return done;

	        });

	        return invoiced;
	    },

	    push_and_invoice_non_charge_checkout_order: function(checkout_order){
	        var self = this;
	        var invoiced = new $.Deferred();


	        if(!checkout_order.get().partner_id){
	            invoiced.reject({code:400, message:'Missing Customer', data:{}});
	            return invoiced;
	        }

            //remove db
	        this.db.remove_orders(checkout_order.get_order_id());

	        var checkout_order_id = this.db.add_checkout_order(checkout_order.export_as_JSON());

	        this.flush_mutex.exec(function(){
	            var done = new $.Deferred(); // holds the mutex

	            // send the order to the server
	            // we have a 30 seconds timeout on this push.
	            // FIXME: if the server takes more than 30 seconds to accept the order,
	            // the client will believe it wasn't successfully sent, and very bad
	            // things will happen as a duplicate will be sent next time
	            // so we must make sure the server detects and ignores duplicated orders

	            var transfer = self._flush_non_charge_checkout_orders([self.db.get_checkout_order(checkout_order_id)], {timeout:30000, to_invoice:true});

	            transfer.fail(function(error){
	                invoiced.reject(error);
	                done.reject();
	            });

	            // on success, get the order id generated by the server
	            transfer.pipe(function(order_checkout_server_id){

	                // generate the pdf and download it
	                self.chrome.do_action('point_of_lounge.lounge_invoice_report',{additional_context:{
	                    active_ids:order_checkout_server_id,
	                }});

	                invoiced.resolve();
	                done.resolve();
	            });

	            return done;

	        });

	        return invoiced;
	    },

	    // wrapper around the _save_to_server that updates the synch status widget
	    _flush_orders: function(orders, options) {
	        var self = this;
	        this.set('synch',{ state: 'connecting', pending: orders.length});

	        return self._save_to_server(orders, options).done(function (server_ids) {
	            var pending = self.db.get_orders().length;

	            self.set('synch', {
	                state: pending ? 'connecting' : 'connected',
	                pending: pending
	            });

	            return server_ids;
	        }).fail(function(error, event){
	            var pending = self.db.get_orders().length;
	            if (self.get('failed')) {
	                self.set('synch', { state: 'error', pending: pending });
	            } else {
	                self.set('synch', { state: 'disconnected', pending: pending });
	            }
	        });
	    },
	    _flush_checkout_orders: function(checkout_orders, options) {
	        var self = this;
	        this.set('synch',{ state: 'connecting', pending: checkout_orders.length});

	        return self._save_checkout_to_server(checkout_orders, options).done(function(server_ids) {
	            var pending = self.db.get_checkout_orders().length;

	            self.set('synch', {
	                state: pending ? 'connecting' : 'connected',
	                pending: pending
	            });

	            return server_ids;
	        }).fail(function(error, event){
	            var pending = self.db.get_checkout_orders().length;
	            if (self.get('failed')) {
	                self.set('synch', { state: 'error', pending: pending });
	            } else {
	                self.set('synch', { state: 'disconnected', pending: pending });
	            }
	        });
	    },

	    _flush_non_charge_checkout_orders: function(checkout_orders, options) {
	        var self = this;
	        this.set('synch',{ state: 'connecting', pending: checkout_orders.length});

	        return self._save_non_charge_checkout_to_server(checkout_orders, options).done(function(server_ids) {
	            var pending = self.db.get_checkout_orders().length;

	            self.set('synch', {
	                state: pending ? 'connecting' : 'connected',
	                pending: pending
	            });

	            return server_ids;
	        }).fail(function(error, event){
	            var pending = self.db.get_checkout_orders().length;
	            if (self.get('failed')) {
	                self.set('synch', { state: 'error', pending: pending });
	            } else {
	                self.set('synch', { state: 'disconnected', pending: pending });
	            }
	        });
	    },

	    // send an array of orders to the server
	    // available options:
	    // - timeout: timeout for the rpc call in ms
	    // returns a deferred that resolves with the list of
	    // server generated ids for the sent orders
	    _save_to_server: function (orders, options) {
	        if (!orders || !orders.length) {
	            var result = $.Deferred();
	            result.resolve([]);
	            return result;
	        }

	        options = options || {};

	        var self = this;
	        var timeout = typeof options.timeout === 'number' ? options.timeout : 7500 * orders.length;

	        // we try to send the order. shadow prevents a spinner if it takes too long. (unless we are sending an invoice,
	        // then we want to notify the user that we are waiting on something )
	        var loungeOrderModel = new Model('lounge.order');
	        return loungeOrderModel.call('create_from_ui',
	            [_.map(orders, function (order) {
	                order.to_invoice = options.to_invoice || false;

	                return order;
	            })],
	            undefined,
	            {
	                shadow: !options.to_invoice,
	                timeout: timeout
	            }
	        ).then(function (server_ids) {
	            _.each(orders, function (order) {
	                self.db.remove_order(order.id);
	            });
	            self.set('failed',false);
	            return server_ids;
	        }).fail(function (error, event){
	            if(error.code === 200 ){    // Business Logic Error, not a connection problem
	                //if warning do not need to display traceback!!
	                if (error.data.exception_type == 'warning') {
	                    delete error.data.debug;
	                }

	                // Hide error if already shown before ...
	                if ((!self.get('failed') || options.show_error) && !options.to_invoice) {
	                    self.gui.show_popup('error-traceback',{
	                        'title': error.data.message,
	                        'body':  error.data.debug
	                    });
	                }
	                self.set('failed',error)
	            }
	            // prevent an error popup creation by the rpc failure
	            // we want the failure to be silent as we send the orders in the background
	            event.preventDefault();
	            console.error('Failed to send orders:', orders);
	        });
	    },

	    // send an array of orders to the server
	    // available options:
	    // - timeout: timeout for the rpc call in ms
	    // returns a deferred that resolves with the list of
	    // server generated ids for the sent orders
	    _save_checkout_to_server: function (checkout_orders, options) {
	        if (!checkout_orders || !checkout_orders.length) {
	            var result = $.Deferred();
	            result.resolve([]);
	            return result;
	        }

	        options = options || {};

	        var self = this;
	        var timeout = typeof options.timeout === 'number' ? options.timeout : 7500 * checkout_orders.length;
	        // we try to send the order. shadow prevents a spinner if it takes too long. (unless we are sending an invoice,
	        // then we want to notify the user that we are waiting on something )
	        var loungeOrderModel = new Model('lounge.order');
	        return loungeOrderModel.call('update_from_ui',
	            [_.map(checkout_orders, function (checkout_order) {
	                checkout_order.to_invoice = options.to_invoice || false;
	                return checkout_order;
	            })],
	            undefined,
	            {
	                shadow: !options.to_invoice,
	                timeout: timeout
	            }
	        ).then(function (server_ids) {
	            _.each(checkout_orders, function (checkout_order) {
	                self.db.remove_checkout_order(checkout_order.id);

	            });
	            self.set('failed',false);
	            return server_ids;
	        }).fail(function (error, event){
	            if(error.code === 200 ) {    // Business Logic Error, not a connection problem
	                //if warning do not need to display traceback!!
	                if (error.data.exception_type == 'warning') {
	                    delete error.data.debug;
	                }

	                /* Hide error if already shown before ...*/
	                if ((!self.get('failed') || options.show_error) && !options.to_invoice) {
	                    self.gui.show_popup('error-traceback',{
	                        'title': error.data.message,
	                        'body':  error.data.debug
	                    });
	                }
	                self.set('failed',error)
	            }
	            // prevent an error popup creation by the rpc failure
	            // we want the failure to be silent as we send the orders in the background
	            event.preventDefault();
	            console.error('Failed to send orders:', checkout_orders);
	        });


	    },

	    // send an array of orders to the server
	    // available options:
	    // - timeout: timeout for the rpc call in ms
	    // returns a deferred that resolves with the list of
	    // server generated ids for the sent orders
	    _save_non_charge_checkout_to_server: function (checkout_orders, options) {
	        if (!checkout_orders || !checkout_orders.length) {
	            var result = $.Deferred();
	            result.resolve([]);
	            return result;
	        }

	        options = options || {};

	        var self = this;
	        var timeout = typeof options.timeout === 'number' ? options.timeout : 7500 * checkout_orders.length;
	        // we try to send the order. shadow prevents a spinner if it takes too long. (unless we are sending an invoice,
	        // then we want to notify the user that we are waiting on something )
	        var loungeOrderModel = new Model('lounge.order');
	        return loungeOrderModel.call('update_non_charge_from_ui',
	            [_.map(checkout_orders, function (checkout_order) {
	                checkout_order.to_invoice = options.to_invoice || false;
	                return checkout_order;
	            })],
	            undefined,
	            {
	                shadow: !options.to_invoice,
	                timeout: timeout
	            }
	        ).then(function (server_ids) {
	            _.each(checkout_orders, function (checkout_order) {
	                self.db.remove_checkout_order(checkout_order.id);

	            });
	            self.set('failed',false);
	            return server_ids;
	        }).fail(function (error, event){
	            if(error.code === 200 ) {    // Business Logic Error, not a connection problem
	                //if warning do not need to display traceback!!
	                if (error.data.exception_type == 'warning') {
	                    delete error.data.debug;
	                }

	                /* Hide error if already shown before ...*/
	                if ((!self.get('failed') || options.show_error) && !options.to_invoice) {
	                    self.gui.show_popup('error-traceback',{
	                        'title': error.data.message,
	                        'body':  error.data.debug
	                    });
	                }
	                self.set('failed',error)
	            }
	            // prevent an error popup creation by the rpc failure
	            // we want the failure to be silent as we send the orders in the background
	            event.preventDefault();
	            console.error('Failed to send orders:', checkout_orders);
	        });


	    },

	    scan_product: function(parsed_code){
	        var selectedOrder = this.get_order();
	        var product = this.db.get_product_by_barcode(parsed_code.base_code);

	        if(!product){
	            return false;
	        }

	        if(parsed_code.type === 'price'){
	            selectedOrder.add_product(product, {price:parsed_code.value});
	        }else if(parsed_code.type === 'weight'){
	            selectedOrder.add_product(product, {quantity:parsed_code.value, merge:false});
	        }else if(parsed_code.type === 'discount'){
	            selectedOrder.add_product(product, {discount:parsed_code.value, merge:false});
	        }else{
	            selectedOrder.add_product(product);
	        }
	        return true;
	    },

	    // Exports the paid orders (the ones waiting for internet connection)
	    export_paid_orders: function() {
	        return JSON.stringify({
	            'paid_orders':  this.db.get_orders(),
	            'session':      this.lounge_session.name,
	            'session_id':   this.lounge_session.id,
	            'date':         (new Date()).toUTCString(),
	            'version':      this.version.server_version_info,
	        },null,2);
	    },

	    // Exports the unpaid orders (the tabs)
	    export_unpaid_orders: function() {
	        return JSON.stringify({
	            'unpaid_orders': this.db.get_unpaid_orders(),
	            'session':       this.lounge_session.name,
	            'session_id':    this.lounge_session.id,
	            'date':          (new Date()).toUTCString(),
	            'version':       this.version.server_version_info,
	        },null,2);
	    },

	    // This imports paid or unpaid orders from a json file whose
	    // contents are provided as the string str.
	    // It returns a report of what could and what could not be
	    // imported.
	    import_orders: function(str) {
	        var json = JSON.parse(str);
	        var report = {
	            // Number of paid orders that were imported
	            paid: 0,
	            // Number of unpaid orders that were imported
	            unpaid: 0,
	            // Orders that were not imported because they already exist (uid conflict)
	            unpaid_skipped_existing: 0,
	            // Orders that were not imported because they belong to another session
	            unpaid_skipped_session:  0,
	            // The list of session ids to which skipped orders belong.
	            unpaid_skipped_sessions: [],
	        };

	        if (json.paid_orders) {
	            for (var i = 0; i < json.paid_orders.length; i++) {
	                this.db.add_order(json.paid_orders[i].data);
	            }
	            report.paid = json.paid_orders.length;
	            this.push_order();
	        }

	        if (json.unpaid_orders) {

	            var orders  = [];
	            var existing = this.get_order_list();
	            var existing_uids = {};
	            var skipped_sessions = {};

	            for (var i = 0; i < existing.length; i++) {
	                existing_uids[existing[i].uid] = true;
	            }

	            for (var i = 0; i < json.unpaid_orders.length; i++) {
	                var order = json.unpaid_orders[i];
	                if (order.lounge_session_id !== this.lounge_session.id) {
	                    report.unpaid_skipped_session += 1;
	                    skipped_sessions[order.lounge_session_id] = true;
	                } else if (existing_uids[order.uid]) {
	                    report.unpaid_skipped_existing += 1;
	                } else {
	                    orders.push(new exports.Order({},{
	                        lounge: this,
	                        json: order,
	                    }));
	                }
	            }

	            orders = orders.sort(function(a,b){
	                return a.sequence_number - b.sequence_number;
	            });

	            if (orders.length) {
	                report.unpaid = orders.length;
	                this.get('orders').add(orders);
	            }

	            report.unpaid_skipped_sessions = _.keys(skipped_sessions);
	        }

	        return report;
	    },

	    _load_orders: function(){
	        var jsons = this.db.get_unpaid_orders();
	        var orders = [];
	        var not_loaded_count = 0;

	        for (var i = 0; i < jsons.length; i++) {
	            var json = jsons[i];
	            if (json.lounge_session_id === this.lounge_session.id) {
	                orders.push(new exports.Order({},{
	                    lounge:  this,
	                    json: json,
	                }));
	            } else {
	                not_loaded_count += 1;
	            }
	        }

	        if (not_loaded_count) {
	            console.info('There are '+not_loaded_count+' locally saved unpaid orders belonging to another session');
	        }

	        orders = orders.sort(function(a,b){
	            return a.sequence_number - b.sequence_number;
	        });

	        if (orders.length) {
	            this.get('orders').add(orders);
	        }
	    },

	});

	// Add fields to the list of read fields when a model is loaded
	// by the lounge
	// e.g: module.load_fields("product.product",['price','category'])

	exports.load_fields = function(model_name, fields) {
	    if (!(fields instanceof Array)) {
	        fields = [fields];
	    }

	    var models = exports.LoungeModel.prototype.models;
	    for (var i = 0; i < models.length; i++) {
	        var model = models[i];
	        if (model.model === model_name) {
	            // if 'fields' is empty all fields are loaded, so we do not need
	            // to modify the array
	            if ((model.fields instanceof Array) && model.fields.length > 0) {
	                model.fields = model.fields.concat(fields || []);
	            }
	        }
	    }
	};

	// Loads openerp models at the point of lounge startup.
	// load_models take an array of model loader declarations.
	// - The models will be loaded in the array order.
	// - If no openerp model name is provided, no server data
	//   will be loaded, but the system can be used to preprocess
	//   data before load.
	// - loader arguments can be functions that return a dynamic
	//   value. The function takes the LoungeModel as the first argument
	//   and a temporary object that is shared by all models, and can
	//   be used to store transient information between model loads.
	// - There is no dependency management. The models must be loaded
	//   in the right order. Newly added models are loaded at the end
	//   but the after / before options can be used to load directly
	//   before / after another model.
	//
	// models: [{
	//  model: [string] the name of the openerp model to load.
	//  label: [string] The label displayed during load.
	//  fields: [[string]|function] the list of fields to be loaded.
	//          Empty Array / Null loads all fields.
	//  order:  [[string]|function] the models will be ordered by
	//          the provided fields
	//  domain: [domain|function] the domain that determines what
	//          models need to be loaded. Null loads everything
	//  ids:    [[id]|function] the id list of the models that must
	//          be loaded. Overrides domain.
	//  context: [Dict|function] the openerp context for the model read
	//  condition: [function] do not load the models if it evaluates to
	//             false.
	//  loaded: [function(self,model)] this function is called once the
	//          models have been loaded, with the data as second argument
	//          if the function returns a deferred, the next model will
	//          wait until it resolves before loading.
	// }]
	//
	// options:
	//   before: [string] The model will be loaded before the named models
	//           (applies to both model name and label)
	//   after:  [string] The model will be loaded after the (last loaded)
	//           named model. (applies to both model name and label)
	//
	exports.load_models = function(models,options) {
	    options = options || {};
	    if (!(models instanceof Array)) {
	        models = [models];
	    }

	    var pmodels = exports.LoungeModel.prototype.models;
	    var index = pmodels.length;
	    if (options.before) {
	        for (var i = 0; i < pmodels.length; i++) {
	            if (    pmodels[i].model === options.before ||
	                    pmodels[i].label === options.before ){
	                index = i;
	                break;
	            }
	        }
	    } else if (options.after) {
	        for (var i = 0; i < pmodels.length; i++) {
	            if (    pmodels[i].model === options.after ||
	                    pmodels[i].label === options.after ){
	                index = i + 1;
	            }
	        }
	    }
	    pmodels.splice.apply(pmodels,[index,0].concat(models));
	};

	var checkout_orderline_id = 1;

	// An orderline represent one element of the content of a client's shopping cart.
	// An orderline contains a product, its quantity, its price, discount. etc.
	// An Order contains zero or more Orderlines.

    exports.CheckoutOrderline = Backbone.Model.extend({
        initialize: function(attr,options){
            this.lounge = options.lounge;
            this.checkout_order = options.checkout_order;
            if (options.json) {
	            this.init_from_JSON(options.json);
	            return;
	        }

            this.product = options.product;
            this.price   = options.product.price;
            this.set_quantity(1);
            this.discount = 0;
            this.discountStr = '0';
            this.type = 'pack';
            this.selected = false;
            this.id  = checkout_orderline_id++;
        },
        clone: function(){
	        var checkout_orderline = new exports.CheckoutOrderline({},{
	            lounge: this.lounge,
	            checkout_order: this.checkout_order,
	            product: this.product,
	            price: this.price,
	        });
	        checkout_orderline.order = null;
	        checkout_orderline.quantity = this.quantity;
	        checkout_orderline.quantityStr = this.quantityStr;
	        checkout_orderline.discount = this.discount;
	        checkout_orderline.type = this.type;
	        checkout_orderline.selected = false;
	        return checkout_orderline;
	    },
        init_from_JSON: function(json) {
	        this.product = this.lounge.db.get_product_by_id(json.product_id);
	        if (!this.product) {
	            console.error('ERROR: attempting to recover product not available in the lounge');
	        }
	        //this.partner = this.lounge.get_client();
	        this.price = json.price_unit;
	        this.set_discount(json.discount);
	        this.set_quantity(json.qty);
	        this.id = json.id;
	        checkout_orderline_id = Math.max(this.id+1,checkout_orderline_id);
	    },
	    export_as_JSON: function() {
	        return {
                 qty: this.get_quantity(),
                 price_unit: this.get_unit_price(),
                 discount: this.get_discount(),
                 product_id: this.get_product().id,
                 tax_ids: [[6, false, _.map(this.get_applicable_taxes(), function(tax){ return tax.id; })]],
                 id: this.id,
                 charge : this.get_charge(),
	        };
	    },
	     //used to create a json of the ticket, to be sent to the printer
	    export_for_printing: function(){
	        return {
	            quantity:           this.get_quantity(),
	            unit_name:          this.get_unit().name,
	            price:              this.get_unit_display_price(),
	            discount:           this.get_discount(),
	            product_name:       this.get_product().display_name,
	            price_display :     this.get_display_price(),
	            price_with_tax :    this.get_price_with_tax(),
	            price_without_tax:  this.get_price_without_tax(),
	            tax:                this.get_tax(),
	            surcharge:          this.get_surcharge(),
	            product_description:      this.get_product().description,
	            product_description_sale: this.get_product().description_sale,
	        };
	    },
	    can_be_merged_with: function(orderline){
	        if( this.get_product().id !== orderline.get_product().id) {
	            return false;
	        }else if(!this.get_unit() || !this.get_unit().groupable){
	            return false;
	        }else if(this.get_product_type() !== orderline.get_product_type()){
	            return false;
	        }else if(this.get_discount() > 0) { // we don't merge discounted orderlines
	            return false;
	        }else if(this.price !== orderline.price){
	            return false;
	        }else{
	            return true;
	        }
	    },
	    merge: function(orderline){
	        this.checkout_order.assert_editable();
	        this.set_quantity(this.get_quantity() + orderline.get_quantity());
	    },
	    // return the checkout product of this orderline
	    get_product: function(){
	        return this.product;
	    },
	    // return the unit of measure of the product
	    get_unit: function(){
	        var unit_id = this.product.uom_id;
	        if(!unit_id){
	            return undefined;
	        }
	        unit_id = unit_id[0];
	        if(!this.lounge){
	            return undefined;
	        }
	        return this.lounge.units_by_id[unit_id];
	    },
	    get_product_type: function(){
	        return this.type;
	    },
	    // sets a discount [0,100]%
	    set_discount: function(discount){
	        var disc = Math.min(Math.max(parseFloat(discount) || 0, 0),100);
	        this.discount = disc;
	        this.discountStr = '' + disc;
	        this.trigger('change',this);
	    },
	    // returns the discount [0,100]%
	    get_discount: function(){
	        return this.discount;
	    },
	    set_quantity: function(quantity){
	        this.checkout_order.assert_editable();
	        if(quantity === 'remove'){
	            this.checkout_order.checkout_remove_orderline(this);
	            return;
	        }else{
	            var quant = parseFloat(quantity) || 0;
	            var unit = this.get_unit();
	            if(unit){
	                if (unit.rounding) {
	                    this.quantity  = quant;
	                    var decimals = this.lounge.dp['Product Unit of Measure'];
	                    this.quantityStr = this.quantity.toFixed(0);
	                } else {
	                    this.quantity  = quant;
	                    this.quantityStr = this.quantity.toFixed(0);
	                }

	            }else{
	                this.quantity    = quant;
	                this.quantityStr = '' + this.quantity;
	            }
	        }
	        this.trigger('change',this);
	    },
	    // selects or deselects this orderline
	    set_selected: function(selected){
	        this.selected = selected;
	        this.trigger('change',this);
	    },
	    // return the quantity of product
	    get_quantity: function(){
	        return this.quantity;
	    },
	    get_quantity_str: function(){
	        return this.quantityStr;
	    },
	    get_quantity_str_with_unit: function(){
	        var unit = this.get_unit();
	        if(unit && !unit.is_unit){
	            return this.quantityStr + ' ' + unit.name;
	        }else{
	            return this.quantityStr;
	        }
	    },
	    get_price_without_tax: function(){
	        return this.get_all_prices().priceWithoutTax;
	    },
	    get_price_with_tax: function(){
	        return this.get_all_prices().priceWithTax;
	    },
	    get_price_with_tax_and_charge: function(){
	        return this.get_all_prices().surcharge;
	    },
	    get_tax: function(){
	        return this.get_all_prices().tax;
	    },
	    get_charge: function() {
			var total_hour = this.checkout_order.get_booking_total();
	        var charge_every = this.get_product().lounge_charge_every;
			var charge_value = !this.get_product().lounge_charge ? 0 : this.get_product().lounge_charge;
			var subtotal_hour_charge = Math.round(total_hour / charge_every);
			var total_hour_charge = subtotal_hour_charge > 1  ? subtotal_hour_charge - 1 : 0;
			var total_charge = charge_value * total_hour_charge;
			return Math.round(total_charge);
	    },
	    get_all_prices: function(){
            var self = this;
            var price_unit = this.get_unit_price() * (1.0 - (this.get_discount() / 100.0));
            var taxtotal = 0;
            var product =  this.get_product();
            var charge = !product.lounge_charge ? 0 : product.lounge_charge;
            var total_hour = this.checkout_order.get_booking_total();
            var hour_if_charge = !product.lounge_charge_every ? 0 : product.lounge_charge_every;
            var taxes_ids = product.taxes_id;
            var taxes =  this.lounge.taxes;
            var taxdetail = {};
	        var product_taxes = [];
	        var total_hour_charge = total_hour == 0 ? 0 : Math.round(total_hour / hour_if_charge);
	        charge = (total_hour_charge <= 1 || !total_hour_charge) ? 0 : (Math.round(charge * (total_hour_charge - 1)));

	        _(taxes_ids).each(function(el){
	            product_taxes.push(_.detect(taxes, function(t){
	                return t.id === el;
	            }));
	        });

	        var all_taxes = this.compute_all(product_taxes, price_unit, charge,this.get_quantity(), this.lounge.currency.rounding);
	        _(all_taxes.taxes).each(function(tax) {
	            taxtotal += tax.amount;
	            taxdetail[tax.id] = tax.amount;
	        });

	        return {
	            "priceWithTax": all_taxes.total_included, // 32.2
	            "priceWithoutTax": all_taxes.total_excluded, //28
	            "tax": taxtotal,
	            "taxDetails": taxdetail,
	            "surcharge": all_taxes.total_included_without_charge, // 18 +
	        };
	    },
	    get_unit_price: function() {
	        var discount = 0;
	        var price = this.price;
	        price = price - discount;
	        return round_di(price || 0, this.lounge.dp['Product Price']);
	    },
	    get_base_price: function(){
	        var rounding = this.lounge.currency.rounding;
	        return round_pr(this.get_unit_price() * this.get_quantity() * (1 - this.get_discount()/100), rounding);
	    },
	    get_base_price_with_charge:    function(){
	        var rounding = this.lounge.currency.rounding;
	        return round_pr((this.get_unit_price() + this.get_charge()) * this.get_quantity() * (1 - this.get_discount()/100), rounding);
	    },
	    get_unit_display_price: function(){
	        if (this.lounge.config.iface_tax_included) {
	            var quantity = this.quantity;
	            this.quantity = 1.0;
	            var price = this.get_all_prices().priceWithTax;
	            this.quantity = quantity;
	            return price;
	        } else {
	            return this.get_unit_price();
	        }
	    },
	    get_display_price: function() {
	        if (this.lounge.config.iface_tax_included) {
	            return this.get_price_with_tax();
	        } else {
	            return this.get_base_price();
	        }
	    },
	    get_display_price_with_charge: function(){
	        if (this.lounge.config.iface_tax_included) {
	            return this.get_price_with_tax_and_charge();
	        } else {
	            return this.get_base_price_with_charge();
	        }
	    },
	    get_surcharge: function(){
	        //return this.get_all_prices().surcharge;
	        return this.get_charge() * this.get_quantity();
	    },
	    _map_tax_fiscal_position: function(tax) {
	        var current_order = this.lounge.get_checkout_order();
	        var order_fiscal_position = current_order && current_order.fiscal_position;

	        if (order_fiscal_position) {
	            var mapped_tax = _.find(order_fiscal_position.fiscal_position_taxes_by_id, function (fiscal_position_tax) {
	                return fiscal_position_tax.tax_src_id[0] === tax.id;
	            });

	            if (mapped_tax) {
	                tax = this.lounge.taxes_by_id[mapped_tax.tax_dest_id[0]];
	            }
	        }

	        return tax;
	    },
	    compute_all: function(taxes, price_unit,charge,quantity, currency_rounding) {
	        var self = this;
	        var total_excluded = round_pr((price_unit) * quantity, currency_rounding);
	        var total_included_without_charge = round_pr((price_unit) * quantity, currency_rounding);
	        var total_included = total_excluded;
	        var base = total_excluded;
	        var list_taxes = [];

	        if (this.lounge.company.tax_calculation_rounding_method == "round_globally"){
	           currency_rounding = currency_rounding * 0.00001;
	        }

	        _(taxes).each(function(tax) {
	            tax = self._map_tax_fiscal_position(tax);
	            if (tax.amount_type === 'group'){
	                var ret = self.compute_all(tax.children_tax_ids, price_unit,charge,quantity, currency_rounding);
	                total_excluded = ret.total_excluded;
	                base = ret.total_excluded;
	                total_included = ret.total_included;
	                total_included_without_charge = ret.total_included_without_charge;
	                list_taxes = list_taxes.concat(ret.taxes);
	            }  else {
	                 var tax_amount = self._compute_all(tax, base, quantity);
	                 if (tax_amount){
	                    if (tax.price_include) {
	                        total_excluded -= tax_amount;
	                        base -= tax_amount;
	                    } else {
	                        total_included += tax_amount;
	                        total_included_without_charge += tax_amount;
	                    }

	                    if (tax.include_base_amount) {
	                        base += tax_amount;
	                    }

	                    var data = {
	                        id: tax.id,
	                        amount: tax_amount,
	                        name: tax.name,
	                    };
	                    list_taxes.push(data);
	                 }
	            }

	        });

	        return {taxes: list_taxes, total_excluded: total_excluded,total_included_without_charge: total_included_without_charge,total_included: total_included};

	    },
	    _compute_all: function(tax, base_amount, quantity) {
	        if (tax.amount_type === 'fixed') {
	            var sign_base_amount = base_amount >= 0 ? 1 : -1;
	            return (Math.abs(tax.amount) * sign_base_amount) * quantity;
	        }
	        if ((tax.amount_type === 'percent' && !tax.price_include) || (tax.amount_type === 'division' && tax.price_include)){
	            return base_amount * tax.amount / 100;
	        }
	        if (tax.amount_type === 'percent' && tax.price_include){
	            return base_amount - (base_amount / (1 + tax.amount / 100));
	        }
	        if (tax.amount_type === 'division' && !tax.price_include) {
	            return base_amount / (1 - tax.amount / 100) - base_amount;
	        }
	        return false;
	    },
	    get_applicable_taxes: function() {
	        var i;
	        // Shenaningans because we need
	        // to keep the taxes ordering.
	        var ptaxes_ids = this.get_product().taxes_id;
	        var ptaxes_set = {};
	        for (i = 0; i < ptaxes_ids.length; i++) {
	            ptaxes_set[ptaxes_ids[i]] = true;
	        }

	        var taxes = [];
	        for (i = 0; i < this.lounge.taxes.length; i++) {
                if (ptaxes_set[this.lounge.taxes[i].id]) {
	                taxes.push(this.lounge.taxes[i]);
	            }
	        }
	    },
	    get_tax_details: function(){
	        return this.get_all_prices().taxDetails;
	    },
    });

    var CheckoutOrderlineCollection = Backbone.Collection.extend({
	    model: exports.CheckoutOrderline,
	});

	var orderline_id = 1;

	// An orderline represent one element of the content of a client's shopping cart.
	// An orderline contains a product, its quantity, its price, discount. etc.
	// An Order contains zero or more Orderlines.
	exports.Orderline = Backbone.Model.extend({
	    initialize: function(attr,options){
	        this.lounge   = options.lounge;
	        this.order = options.order;
	        if (options.json) {
	            this.init_from_JSON(options.json);
	            return;
	        }
	        //alert(options.product);
	        this.product = options.product;
	        this.price   = options.product.price;
	        this.set_quantity(1);
	        this.discount = 0;
	        this.charge = 0;
	        this.discountStr = '0';
	        this.type = 'pack';
	        this.selected = false;
	        this.id = orderline_id++;
	    },
	    init_from_JSON: function(json) {
	        this.product = this.lounge.db.get_product_by_id(json.product_id);
	        if (!this.product) {
	            console.error('ERROR: attempting to recover product not available in the lounge');
	        }
	        //this.partner = this.lounge.get_client();
	        this.price = json.price_unit;
	        this.set_discount(json.discount);
	        this.set_quantity(json.qty);
	        this.id    = json.id;
	        orderline_id = Math.max(this.id+1,orderline_id);
	    },
	    clone: function(){
	        var orderline = new exports.Orderline({},{
	            lounge: this.lounge,
	            order: this.order,
	            product: this.product,
	            price: this.price,
	        });
	        orderline.order = null;
	        orderline.quantity = this.quantity;
	        orderline.quantityStr = this.quantityStr;
	        orderline.discount = this.discount;
	        orderline.type = this.type;
	        orderline.selected = false;
	        return orderline;
	    },

	    // sets a discount [0,100]%
	    set_discount: function(discount){
	        var disc = Math.min(Math.max(parseFloat(discount) || 0, 0),100);
	        this.discount = disc;
	        this.discountStr = '' + disc;
	        this.trigger('change',this);
	    },
	     // sets a refresh
	    set_refresh: function() {
	         this.trigger('change',this);
	    },
	    // returns the discount [0,100]%
	    get_discount: function(){
	        return this.discount;
	    },

	    get_discount_str: function(){
	        return this.discountStr;
	    },

	    get_charge: function() {
			var total_hour = this.lounge.get_booking_total();
	        var charge_every = this.get_product().lounge_charge_every;
			var charge_value = !this.get_product().lounge_charge ? 0 : this.get_product().lounge_charge;
			var subtotal_hour_charge = charge_every > 0 ? Math.round(total_hour / charge_every) : 0;
			var total_hour_charge = subtotal_hour_charge > 1  ? subtotal_hour_charge - 1 : 0;
			var total_charge = charge_value * total_hour_charge;
			return Math.round(total_charge);
	    },
	    get_product_type: function(){
	        return this.type;
	    },
	    // sets the quantity of the product. The quantity will be rounded according to the
	    // product's unity of measure properties. Quantities greater than zero will not get
	    // rounded to zero
	    set_quantity: function(quantity){
	        this.order.assert_editable();
	        if(quantity === 'remove'){
	            this.order.remove_orderline(this);
	            return;
	        }else{
	            var quant = parseFloat(quantity) || 0;
	            var unit = this.get_unit();
	            if(unit){
	                if (unit.rounding) {
	                    //this.quantity    = round_pr(quant, unit.rounding);
	                    this.quantity  = quant;
	                    var decimals = this.lounge.dp['Product Unit of Measure'];
	                    this.quantityStr = this.quantity.toFixed(0);
	                    //this.quantityStr = formats.format_value(round_di(this.quantity, decimals), { type: 'float', digits: [69, decimals]});
	                } else {
	                    //this.quantity    = round_pr(quant, 1);
	                    this.quantity  = quant;
	                    this.quantityStr = this.quantity.toFixed(0);

	                }

	            }else{
	                this.quantity    = quant;
	                this.quantityStr = '' + this.quantity;
	            }
	        }
	        this.trigger('change',this);
	    },
	    // return the quantity of product
	    get_quantity: function(){
	        return this.quantity;
	    },
	    get_quantity_str: function(){
	        return this.quantityStr;
	    },
	    get_quantity_str_with_unit: function(){
	        var unit = this.get_unit();
	        if(unit && !unit.is_unit){
	            return this.quantityStr + ' ' + unit.name;
	        }else{
	            return this.quantityStr;
	        }
	    },
	    // return the unit of measure of the product
	    get_unit: function(){
	        var unit_id = this.product.uom_id;
	        if(!unit_id){
	            return undefined;
	        }
	        unit_id = unit_id[0];
	        if(!this.lounge){
	            return undefined;
	        }
	        return this.lounge.units_by_id[unit_id];
	    },
	    // return the product of this orderline
	    get_product: function(){
	        return this.product;
	    },
	    get_partner: function(){
	        return this.partner;
	    },
	    // selects or deselects this orderline
	    set_selected: function(selected){
	        this.selected = selected;
	        this.trigger('change',this);
	    },
	    // returns true if this orderline is selected
	    is_selected: function(){
	        return this.selected;
	    },
	    // when we add an new orderline we want to merge it with the last line to see reduce the number of items
	    // in the orderline. This returns true if it makes sense to merge the two
	    can_be_merged_with: function(orderline){
	        if( this.get_product().id !== orderline.get_product().id){    //only orderline of the same product can be merged
	            return false;
	        }else if(!this.get_unit() || !this.get_unit().groupable){
	            return false;
	        }else if(this.get_product_type() !== orderline.get_product_type()){
	            return false;
	        }else if(this.get_discount() > 0){             // we don't merge discounted orderlines
	            return false;
	        }else if(this.price !== orderline.price){
	            return false;
	        }else{
	            return true;
	        }
	    },
	    merge: function(orderline){
	        this.order.assert_editable();
	        this.set_quantity(this.get_quantity() + orderline.get_quantity());
	    },
	    export_as_JSON: function() {
	        return {
	            qty: this.get_quantity(),
	            price_unit: this.get_free_pax() > 0 ?  this.get_unit_price_with_free_pax() : this.get_unit_price(),
	            discount: this.get_discount(),
	            free_pax:this.get_free_pax(),
	            product_id: this.get_product().id,
	            tax_ids: [[6, false, _.map(this.get_applicable_taxes(), function(tax){ return tax.id; })]],
	            id: this.id,
	            charge: this.get_charge(),

	        };
	    },
	    //used to create a json of the ticket, to be sent to the printer
	    export_for_printing: function(){
	        return {
	            quantity:           this.get_quantity(),
	            unit_name:          this.get_unit().name,
	            price:              this.get_unit_display_price(),
	            discount:           this.get_discount(),
	            product_name:       this.get_product().display_name,
	            price_display :     this.get_display_price(),
	            price_with_tax :    this.get_price_with_tax(),
	            price_without_tax:  this.get_price_without_tax(),
	            tax:                this.get_tax(),
				surcharge:          this.get_surcharge(),
	            product_description:      this.get_product().description,
	            product_description_sale: this.get_product().description_sale,
	        };
	    },
	    // changes the base price of the product for this orderline
	    set_unit_price: function(price){
	        this.order.assert_editable();
	        this.price = round_di(parseFloat(price) || 0, this.lounge.dp['Product Price']);
	        this.trigger('change',this);
	    },
	    get_unit_price: function() {
	        var discount = 0;
	        var price = this.price;
	        if(this.order.get_client()) {
	            var customer_type = this.order.get_client().company_type;
                if(customer_type == 'company') {
                    //discount = !this.product.discount_company ? 0 : this.product.discount_company;
                    if(this.product.is_disc_company == true) {
                        discount =  !this.order.get_client().disc_product ? 0 : this.order.get_client().disc_product;
                    }
                } else {
                    discount = 0;
                }
	        }
	        price = price - discount;
	        return round_di(price || 0, this.lounge.dp['Product Price']);
	    },
	    get_unit_price_with_free_pax: function() {
            var payment_method = this.order.get_payment_method();
            var max_pax = this.get_free_pax();
            var amount_fixed_price = payment_method.journal.amount_fixed_price;
            var price = this.price;
            var unit_price

            var qty = this.get_quantity() - max_pax;
            if(qty > 0){
                var unit_price_with_disc = 0 ;
                var unit_price_wiht_no_disc= 0;


                for(var i=0;i<max_pax;i++){
                    unit_price_with_disc+=amount_fixed_price/this.order.get_total_items();
                }

                for(var j=0;i<qty;j++){
                    unit_price_with_no_disc+=price;
                }

                unit_price = unit_price_with_disc +  unit_price_with_no_disc;
                unit_price = unit_price/this.get_quantity();

            } else {
                unit_price = amount_fixed_price/this.order.get_total_items();
                unit_price = unit_price/this.get_quantity();
            }

            return round_di(unit_price || 0, this.lounge.dp['Product Price']);
	    },
	    get_unit_display_price: function(){
	        if (this.lounge.config.iface_tax_included) {
	            var quantity = this.quantity;
	            this.quantity = 1.0;
	            var price = this.get_all_prices().priceWithTax;
	            this.quantity = quantity;
	            return price;
	        } else {
	            return this.get_unit_price();
	        }
	    },
	    get_base_price:    function(){
	        var rounding = this.lounge.currency.rounding;
	        return round_pr(this.get_unit_price() * this.get_quantity() * (1 - this.get_discount()/100), rounding);
	    },
	    get_free_pax: function() {
	        var max_pax = 0;
	        var payment_method = this.order.get_payment_method();
	        if(payment_method) {
	             max_pax = payment_method.journal.max_pax;
	        }
	        return max_pax;
	    },
	    get_base_price_with_charge:function() {
	        var max_pax = 0;
	        var amount_fixed_price = 0;
	        var rounding = this.lounge.currency.rounding;
            var quantity;
            var unit_price = 0;
            var subtotal = 0;

	        var payment_method = this.order.get_payment_method();
	        if(payment_method) {
	            if(payment_method.journal.journal_change_amount == true) {
                    max_pax = payment_method.journal.max_pax;
	                amount_fixed_price = payment_method.journal.amount_fixed_price;

                    // 1 , 2
                    quantity = this.get_quantity() - max_pax;
                    if(quantity > 0){
                        unit_price = (amount_fixed_price/this.order.get_total_items()) * 1;
                        subtotal = unit_price + ((this.get_unit_price() + this.get_charge()) * quantity * (1 - this.get_discount()/100));
                    }
                    else{
                        unit_price = amount_fixed_price/this.order.get_total_items();
                        quantity = 1;
                        subtotal = (unit_price + this.get_charge()) * quantity * (1 - this.get_discount()/100);

                    }
	            } else {
	                subtotal = (this.get_unit_price() + this.get_charge()) * this.get_quantity() * (1 - this.get_discount()/100);
	            }
	        } else {
	            subtotal = (this.get_unit_price() + this.get_charge()) * this.get_quantity() * (1 - this.get_discount()/100);
	        }

	        return round_pr(subtotal, rounding);
	        //var rounding = this.lounge.currency.rounding;
	        //return round_pr((this.get_unit_price() + this.get_charge()) * this.get_quantity() * (1 - this.get_discount()/100), rounding);
	    },
	    get_display_price: function(){
	        if (this.lounge.config.iface_tax_included) {
	            return this.get_price_with_tax();
	        } else {
	            return this.get_base_price();
	        }
	    },
	    get_display_price_with_charge: function(){
	        if (this.lounge.config.iface_tax_included) {
	            return this.get_price_with_tax_and_charge();
	        } else {
	            return this.get_base_price_with_charge();
	        }
	    },
	    get_price_without_tax: function(){
	        //this.trigger('change',this);
	        return this.get_all_prices().priceWithoutTax;
	    },
	    get_price_with_tax: function(){
	        return this.get_all_prices().priceWithTax;
	    },
	    get_price_with_tax_and_charge: function(){
	        return this.get_all_prices().surcharge;
	    },
	    get_tax: function(){
	        return this.get_all_prices().tax;
	    },
	    get_surcharge: function(){
	        return this.get_all_prices().surcharge;
	    },
	    get_applicable_taxes: function(){
	        var i;
	        // Shenaningans because we need
	        // to keep the taxes ordering.
	        var ptaxes_ids = this.get_product().taxes_id;
	        var ptaxes_set = {};
	        for (i = 0; i < ptaxes_ids.length; i++) {
	            ptaxes_set[ptaxes_ids[i]] = true;
	        }
	        var taxes = [];
	        for (i = 0; i < this.lounge.taxes.length; i++) {
	            if (ptaxes_set[this.lounge.taxes[i].id]) {
	                taxes.push(this.lounge.taxes[i]);
	            }
	        }
	        return taxes;
	    },
	    get_tax_details: function(){
	        return this.get_all_prices().taxDetails;
	    },
	    get_taxes: function(){
	        var taxes_ids = this.get_product().taxes_id;
	        var taxes = [];
	        for (var i = 0; i < taxes_ids.length; i++) {
	            taxes.push(this.lounge.taxes_by_id[taxes_ids[i]]);
	        }
	        return taxes;
	    },
	    _map_tax_fiscal_position: function(tax) {
	        var current_order = this.lounge.get_order();
	        var order_fiscal_position = current_order && current_order.fiscal_position;

	        if (order_fiscal_position) {
	            var mapped_tax = _.find(order_fiscal_position.fiscal_position_taxes_by_id, function (fiscal_position_tax) {
	                return fiscal_position_tax.tax_src_id[0] === tax.id;
	            });

	            if (mapped_tax) {
	                tax = this.lounge.taxes_by_id[mapped_tax.tax_dest_id[0]];
	            }
	        }

	        return tax;
	    },
	    _compute_all: function(tax, base_amount, quantity) {
	        if (tax.amount_type === 'fixed') {
	            var sign_base_amount = base_amount >= 0 ? 1 : -1;
	            return (Math.abs(tax.amount) * sign_base_amount) * quantity;
	        }
	        if ((tax.amount_type === 'percent' && !tax.price_include) || (tax.amount_type === 'division' && tax.price_include)){
	            return base_amount * tax.amount / 100;
	        }
	        if (tax.amount_type === 'percent' && tax.price_include){
	            return base_amount - (base_amount / (1 + tax.amount / 100));
	        }
	        if (tax.amount_type === 'division' && !tax.price_include) {
	            return base_amount / (1 - tax.amount / 100) - base_amount;
	        }
	        return false;
	    },
	    compute_all: function(taxes, price_unit,charge, quantity, currency_rounding) {
	        var self = this;
	        var amount_fixed_price = 0;
	        var max_pax = 0;
	        var unit_price = 0;
            var subtotal = 0;
            var total_excluded = 0;
            var total_included_without_charge= 0;

            var payment_method = this.order.get_payment_method();

            if(payment_method) {
                if(payment_method.journal.journal_change_amount == true) {
                    max_pax = payment_method.journal.max_pax;
                    amount_fixed_price = payment_method.journal.amount_fixed_price;
                    quantity = quantity - max_pax;
                    if(quantity > 0){
                        unit_price = amount_fixed_price/this.order.get_total_items();
                        total_excluded = round_pr(unit_price + ((price_unit + charge) * quantity * (1 - this.get_discount()/100)),currency_rounding);
                        total_included_without_charge = round_pr(unit_price + (price_unit * quantity ), currency_rounding);
                    }else {
                        unit_price = amount_fixed_price/this.order.get_total_items();
                        quantity = 1;
                        total_excluded = round_pr(unit_price * quantity * (1 - this.get_discount()/100),currency_rounding);
                        total_included_without_charge = round_pr(unit_price * quantity, currency_rounding);
                    }
                } else {
                    total_excluded = round_pr((price_unit + charge) * quantity, currency_rounding);
	                total_included_without_charge = round_pr((price_unit) * quantity, currency_rounding);
                }
            } else {
                total_excluded = round_pr((price_unit + charge) * quantity, currency_rounding);
	            total_included_without_charge = round_pr((price_unit) * quantity, currency_rounding);
            }

	        //var total_excluded = round_pr((price_unit + charge) * quantity, currency_rounding);
	        //var total_included_without_charge = round_pr((price_unit) * quantity, currency_rounding);
	        var total_included = total_excluded;
	        var base = total_excluded;
	        var list_taxes = [];
	        if (this.lounge.company.tax_calculation_rounding_method == "round_globally"){
	           currency_rounding = currency_rounding * 0.00001;
	        }
	        _(taxes).each(function(tax) {
	            tax = self._map_tax_fiscal_position(tax);
	            if (tax.amount_type === 'group'){
	                var ret = self.compute_all(tax.children_tax_ids, price_unit,charge, quantity, currency_rounding);
	                total_excluded = ret.total_excluded;
	                base = ret.total_excluded;
	                total_included = ret.total_included;
	                total_included_without_charge = ret.total_included_without_charge;
	                list_taxes = list_taxes.concat(ret.taxes);
	            }
	            else {
	                var tax_amount = self._compute_all(tax, base, quantity);
	                tax_amount = round_pr(tax_amount, currency_rounding);

	                if (tax_amount){
	                    if (tax.price_include) {
	                        total_excluded -= tax_amount;
	                        base -= tax_amount;
	                    }
	                    else {
	                        total_included += tax_amount;
	                        total_included_without_charge += tax_amount;
	                    }
	                    if (tax.include_base_amount) {
	                        base += tax_amount;
	                    }
	                    var data = {
	                        id: tax.id,
	                        amount: tax_amount,
	                        name: tax.name,
	                    };
	                    list_taxes.push(data);
	                }
	            }
	        });
	        return {taxes: list_taxes, total_excluded: total_excluded,total_included_without_charge: total_included_without_charge, total_included: total_included};
	    },
	    get_all_replace: function(args,search_value,new_value) {
	        var i = 0;
	        var str = args;
	        var strLength = str.length;
            for(i; i < strLength; i++) {
                str = str.replace(search_value, new_value);
            }
            return str;
	    },
	    get_booking_total: function() {
	        var time_total = this.order.get_booking_total();
	        return time_total;
	    },
	    get_all_prices: function(){
	        var self = this;
	        var price_unit = this.get_unit_price() * (1.0 - (this.get_discount() / 100.0));
	        var taxtotal = 0;
	        var product =  this.get_product();
	        var taxes_ids = product.taxes_id;
	        var taxes =  this.lounge.taxes;
	        var taxdetail = {};
	        var product_taxes = [];
            var charge = this.get_charge();

	        _(taxes_ids).each(function(el){
	            product_taxes.push(_.detect(taxes, function(t){
	                return t.id === el;
	            }));
	        });

	        var all_taxes = this.compute_all(product_taxes, price_unit, charge , this.get_quantity(), this.lounge.currency.rounding);
	        _(all_taxes.taxes).each(function(tax) {
	            taxtotal += tax.amount;
	            taxdetail[tax.id] = tax.amount;
	        });

	        return {
	            "priceWithTax": all_taxes.total_included, // 32.2
	            "priceWithoutTax": all_taxes.total_excluded, //28
	            "tax": taxtotal,
	            "taxDetails": taxdetail,
	            "surcharge": all_taxes.total_included_without_charge, // 18 +
	        };
	    },
	});

	var OrderlineCollection = Backbone.Collection.extend({
	    model: exports.Orderline,
	});

	// Every Paymentline contains a cashregister and an amount of money.
	exports.Paymentline = Backbone.Model.extend({
	    initialize: function(attributes, options) {
	        this.lounge = options.lounge;
	        this.order = options.order;
	        this.amount = 0;
	        this.selected = false;
	        if (options.json) {
	            this.init_from_JSON(options.json);
	            return;
	        }
	        this.cashregister = options.cashregister;
	        this.name = this.cashregister.journal_id[1];

	    },
	    init_from_JSON: function(json){
	        this.amount = json.amount;
	        this.cashregister = this.lounge.cashregisters_by_id[json.statement_id];
	        this.name = this.cashregister.journal_id[1];

	    },
	    //sets the amount of money on this payment line
	    set_amount: function(value){
	        this.order.assert_editable();
	        this.amount = round_di(parseFloat(value) || 0, this.lounge.currency.decimals);
	        /*if(this.get_change_amount() == true) {this
	            this.amount = round_di(parseFloat(this.get_amount_fixed_price()) || 0, this.lounge.currency.decimals);
	        } else {
	            this.amount = round_di(parseFloat(value) || 0, this.lounge.currency.decimals);
	        }*/
	        this.trigger('change',this);
	    },
	    // returns the amount of money on this paymentline
	    get_amount: function(){
	        return this.amount;
	    },
	    get_amount_str: function(){
	        return formats.format_value(this.amount, {
	            type: 'float', digits: [69, this.lounge.currency.decimals]
	        });
	    },
	    set_selected: function(selected){
	        if(this.selected !== selected){
	            this.selected = selected;
	            this.trigger('change',this);
	        }
	    },
	    // returns the payment change : 'true' | 'false'
	    get_change_amount: function(){
	        return this.cashregister.journal.journal_change_amount;
	    },
	    // returns the payment with fixed price
	    get_amount_fixed_price: function(){
	        return this.cashregister.journal.amount_fixed_price;
	    },
	    get_max_pax: function() {
	        return this.cashregister.journal.max_pax;
	    },
	    // returns the payment type: 'cash' | 'bank'
	    get_type: function(){
	        return this.cashregister.journal.type;
	    },
	    // returns the associated cashregister
	    //exports as JSON for server communication
	    export_as_JSON: function(){
	        return {
	            name: time.datetime_to_str(new Date()),
	            statement_id: this.cashregister.id,
	            lounge_account_id: this.cashregister.lounge_account_id[0],
	            journal_id: this.cashregister.journal_id[0],
	            amount: this.get_amount()
	        };
	    },
	    //exports as JSON for receipt printing
	    export_for_printing: function(){
	        return {
	            amount: this.get_amount(),
	            journal: this.cashregister.journal_id[1],
	        };
	    },
	});

	var PaymentlineCollection = Backbone.Collection.extend({
	    model: exports.Paymentline,
	});

	// Every Paymentline contains a cashregister and an amount of money.
	exports.CheckoutPaymentline = Backbone.Model.extend({
	    initialize: function(attributes, options) {
	        this.lounge = options.lounge;
	        this.checkout_order = options.checkout_order;
	        this.amount = 0;
	        this.selected = false;
	        if (options.json) {
	            this.init_from_JSON(options.json);
	            return;
	        }
	        this.cashregister = options.cashregister;
	        this.name = this.cashregister.journal_id[1];
	    },
	    init_from_JSON: function(json){
	        this.amount = json.amount;
	        this.cashregister = this.lounge.cashregisters_by_id[json.statement_id];
	        this.name = this.cashregister.journal_id[1];
	    },
	    //sets the amount of money on this payment line
	    set_amount: function(value){
	        this.checkout_order.assert_editable();
	        this.amount = round_di(parseFloat(value) || 0, this.lounge.currency.decimals);
	        this.trigger('change',this);
	    },
	    // returns the amount of money on this paymentline
	    get_amount: function(){
	        return this.amount;
	    },
	    get_amount_str: function(){
	        return formats.format_value(this.amount, {
	            type: 'float', digits: [69, this.lounge.currency.decimals]
	        });
	    },
	    set_selected: function(selected){
	        if(this.selected !== selected){
	            this.selected = selected;
	            this.trigger('change',this);
	        }
	    },
	    // returns the payment type: 'cash' | 'bank'
	    get_type: function(){
	        return this.cashregister.journal.type;
	    },
	    // returns the associated cashregister
	    //exports as JSON for server communication
	    export_as_JSON: function(){
	        return {
	            name: time.datetime_to_str(new Date()),
	            statement_id: this.cashregister.id,
	            lounge_account_id: this.cashregister.lounge_account_id[0],
	            journal_id: this.cashregister.journal_id[0],
	            amount: this.get_amount()
	        };
	    },
	    //exports as JSON for receipt printing
	    export_for_printing: function(){
	        return {
	            amount: this.get_amount(),
	            journal: this.cashregister.journal_id[1],
	        };
	    },
	});

	var CheckoutPaymentlineCollection = Backbone.Collection.extend({
	    model: exports.CheckoutPaymentline,
	});

	exports.CheckoutOrder = Backbone.Model.extend({
        initialize: function(attributes,options){
            Backbone.Model.prototype.initialize.apply(this, arguments);
            options  = options || {};
            this.order_id = null;
            this.checkout_order = null;
            this.init_locked  = true;
            this.lounge = options.lounge;
            this.selected_checkout_orderline = undefined;
            this.selected_checkout_paymentline = undefined;
            this.screen_data = {};  // see Gui
            this.temporary = options.temporary || false;
            this.name = null;
            this.creation_date  = new Date();
            this.booking_to_date = null;
            this.booking_total = 0;
            this.last_payment = 0;
            this.total_payment = 0;
            this.to_invoice = false;
            this.checkout_orderlines = new CheckoutOrderlineCollection();
            this.checkout_paymentlines   = new CheckoutPaymentlineCollection();
            this.lounge_session_id = this.lounge.lounge_session.id;
            this.finalized = false;//if true,cannot be modified.

            this.set({ client: null });
            this.set({ last_order: null });

            if (options.json) {
                this.init_from_JSON(options.json);
            } else {
                this.sequence_number = this.lounge.lounge_session.sequence_number++;
                this.uid  = this.generate_unique_id();
                //this.name = _t("Order ") + this.uid;
                this.validation_date = undefined;
            }

            this.on('change',function(){this.save_to_db("checkout_order:change");}, this);
            this.checkout_orderlines.on('change',function(){this.save_to_db("checkout_orderline:change"); },this);
            this.checkout_orderlines.on('add',function(){ this.save_to_db("checkout_orderline:add"); },this);
            this.checkout_orderlines.on('remove',function(){ this.save_to_db("checkout_orderline:remove");}, this);

            this.checkout_paymentlines.on('change',function(){this.save_to_db("checkout_paymentline:change");},this);
            this.checkout_paymentlines.on('add',function(){this.save_to_db("checkout_paymentline:add"); }, this);
	        this.checkout_paymentlines.on('remove',function(){this.save_to_db("checkout_paymentline:rem"); }, this);

	        this.init_locked = false;
	        this.save_to_db();
	        return this;
	    },
	    save_to_db: function() {
	        if (!this.temporary && !this.init_locked) {
	            this.lounge.db.save_unpaid_checkout_order(this);
	        }
	    },
	    init_from_JSON: function(json) {
	        var client;
	        var last_order;
	        this.sequence_number = json.sequence_number;
	        this.lounge.lounge_session.sequence_number = Math.max(this.sequence_number+1,this.lounge.lounge_session.sequence_number);
	        this.session_id    = json.lounge_session_id;
	        this.uid = json.uid;
	        this.name = _t("Order ") + this.uid;
	        this.validation_date = json.creation_date;

	        if (json.fiscal_position_id) {
	            var fiscal_position = _.find(this.lounge.fiscal_positions, function (fp) {
	                return fp.id === json.fiscal_position_id;
	            });

	            if (fiscal_position) {
	                this.fiscal_position = fiscal_position;
	            } else {
	                console.error('ERROR: trying to load a fiscal position not available in the lounge');
	            }
	        }

	        if (json.partner_id) {
	            client = this.lounge.db.get_partner_by_id(json.partner_id);
	            if (!client) {
	                console.error('ERROR: trying to load a parner not available in the lounge');
	            }
	        } else {
	            client = null;
	        }
	        this.set_client(client);

	        if (json.id) {
	            last_order = this.lounge.db.get_order_by_id(json.id);
	            if (!last_order) {
	                console.error('ERROR: trying to load a last order not available in the lounge');
	            }
	        } else {
	            last_order = null;
	        }
	        this.set_last_order(last_order);

	        this.temporary = false;     // FIXME
	        this.to_invoice = false;    // FIXME

	        var orderlines = json.lines;
	        for (var i = 0; i < orderlines.length; i++) {
	            var orderline = orderlines[i][2];
	            this.add_orderline(new exports.CheckoutOrderline({}, {lounge: this.lounge, checkout_order: this, json: orderline}));
	        }

	        var paymentlines = json.statement_ids;
	        for (var i = 0; i < paymentlines.length; i++) {
	            var paymentline = paymentlines[i][2];
	            var newpaymentline = new exports.CheckoutPaymentline({},{lounge: this.lounge, checkout_order: this, json: paymentline});
	            this.checkout_paymentlines.add(newpaymentline);

	            if (i === paymentlines.length - 1) {
	                this.select_paymentline(newpaymentline);
	            }
	        }
	    },
	    export_as_JSON: function() {
	        var orderLines, paymentLines;
	        orderLines = [];
	        this.checkout_orderlines.each(_.bind( function(item) {
	            return orderLines.push([0, 0, item.export_as_JSON()]);
	        }, this));
	        paymentLines = [];
	        this.checkout_paymentlines.each(_.bind( function(item) {
	            return paymentLines.push([0, 0, item.export_as_JSON()]);
	        }, this));

	        return {
	            id : this.get_order_id(),
	            xid : this.get_order_id(),
                name : this.get_name(),
                booking_to_date: this.get_booking_to_date(),
                booking_total: this.get_booking_total(),
                amount_paid: this.get_total_paid(),
                amount_total: this.get_total_with_tax(),
	            amount_tax: this.get_total_tax(),
	            amount_return: this.get_change(),
	            lines: orderLines,
	            statement_ids: paymentLines,
	            lounge_session_id: this.lounge_session_id,
	            partner_id: this.get_client() ? this.get_client().id : false,
                user_id: this.lounge.cashier ? this.lounge.cashier.id : this.lounge.user.id,
                uid: this.uid,
                sequence_number: this.sequence_number,
                creation_date: this.validation_date || this.creation_date, // todo: rename creation_date in master
                fiscal_position_id: this.fiscal_position ? this.fiscal_position.id : false
	        }
	    },
	    //used to create a json of the ticket, to be sent to the printer
	    export_for_printing: function() {
	        var orderlines = [];
	        var self = this;

	        this.checkout_orderlines.each(function(orderline) {
	            orderlines.push(orderline.export_for_printing());
	        });

	        var paymentlines = [];
	        this.checkout_paymentlines.each(function(paymentline){
	            paymentlines.push(paymentline.export_for_printing());
	        });

	        var client  = this.get('client');
	        var last_order = this.get('last_order');
	        var cashier = this.lounge.cashier || this.lounge.user;
	        var company = this.lounge.company;
	        var shop = this.lounge.shop;
	        var date    = new Date();

	        function is_xml(subreceipt){
	            return subreceipt ? (subreceipt.split('\n')[0].indexOf('<!DOCTYPE QWEB') >= 0) : false;
	        }

	        function render_xml(subreceipt){
	            if (!is_xml(subreceipt)) {
	                return subreceipt;
	            } else {
	                subreceipt = subreceipt.split('\n').slice(1).join('\n');
	                var qweb = new QWeb2.Engine();
	                qweb.debug = core.debug;
	                qweb.default_dict = _.clone(QWeb.default_dict);
	                qweb.add_template('<templates><t t-name="subreceipt">'+subreceipt+'</t></templates>');
	                return qweb.render('subreceipt',{'lounge':self.lounge,'widget':self.lounge.chrome,'order':self, 'receipt': receipt});
	            }
	        }

	        var receipt = {
	            orderlines: orderlines,
	            paymentlines: paymentlines,
	            subtotal: this.get_subtotal(),
	            total_with_tax: this.get_total_with_tax(),
	            total_without_tax: this.get_total_without_tax(),
	            total_tax: this.get_total_tax(),
	            total_paid: this.get_total_paid(),
	            total_discount: this.get_total_discount(),
	            tax_details: this.get_tax_details(),
	            change: this.get_change(),
	            name : this.get_name(),
	            client: client ? client.name : null ,
	            invoice_id: null,   //TODO
	            cashier: cashier ? cashier.name : null,
	            precision: {
	                price: 2,
	                money: 2,
	                quantity: 3,
	            },
	            date: {
	                year: date.getFullYear(),
	                month: date.getMonth(),
	                date: date.getDate(),       // day of the month
	                day: date.getDay(),         // day of the week
	                hour: date.getHours(),
	                minute: date.getMinutes() ,
	                isostring: date.toISOString(),
	                localestring: date.toLocaleString(),
	            },
	            company:{
	                email: company.email,
	                website: company.website,
	                company_registry: company.company_registry,
	                contact_address: company.partner_id[1],
	                vat: company.vat,
	                name: company.name,
	                phone: company.phone,
	                logo:  this.lounge.company_logo_base64,
	            },
	            shop:{
	                name: shop.name,
	            },
	            currency: this.lounge.currency,
	        };

	        if (is_xml(this.lounge.config.receipt_header)){
	            receipt.header = '';
	            receipt.header_xml = render_xml(this.lounge.config.receipt_header);
	        } else {
	            receipt.header = this.lounge.config.receipt_header || '';
	        }

	        if (is_xml(this.lounge.config.receipt_footer)){
	            receipt.footer = '';
	            receipt.footer_xml = render_xml(this.lounge.config.receipt_footer);
	        } else {
	            receipt.footer = this.lounge.config.receipt_footer || '';
	        }



	        return receipt;
	    },
	    generate_unique_id: function() {
	        function zero_pad(num,size){
	            var s = ""+num;
	            while (s.length < size) {
	                s = "0" + s;
	            }
	            return s;
	        }
	        return zero_pad(this.lounge.lounge_session.id,5) +'-'+
	               zero_pad(this.lounge.lounge_session.login_number,3) +'-'+
	               zero_pad(this.sequence_number,4);
	    },
	    assert_editable: function() {
	        if (this.finalized) {
	            throw new Error('Finalized Checkout Order cannot be modified');
	        }
	    },
	    set:function(checkout_order) {
	        this.assert_editable();
	        return this.checkout_order = checkout_order;
	    },
	    get: function(){
	        return this.checkout_order;
	    },
	    set_order_id: function(order_id) {
	        return this.order_id = order_id;
	    },
	    get_order_id: function() {
	        return this.order_id;
	    },
	    set_name: function(name) {
	        return this.name = name;
	    },
	    get_name: function() {
	        return this.name;
	    },
	    set_booking_to_date: function(booking_to_date) {
	        return this.booking_to_date = booking_to_date;
	    },
	    get_booking_to_date: function() {
	        return this.booking_to_date;
	    },
	    set_booking_total: function(booking_total) {
	        this.assert_editable();
	        //this.set('booking_total',booking_total);
	        return this.booking_total = booking_total;
	    },
	    get_booking_total: function() {
	        //return this.get('booking_total');
	        return this.booking_total;
	    },
	    /* ---- Client / Customer --- */
	    // the client related to the current order.
	    set_client: function(client){
	        this.assert_editable();
	        this.set('client',client);
	    },
	    get_client: function(){
	        return this.get('client');
	    },
	    get_client_name: function(){
	        var client = this.get('client');
	        return client ? client.name : "";
	    },
	    set_last_order: function(last_order){
	        this.assert_editable();
	        this.set('last_order',last_order);
	    },
	    get_last_order: function(){
	        return this.get('last_order');
	    },
	    get_last_orderline: function() {
	        return this.checkout_orderlines.at(this.checkout_orderlines.length -1);
	    },
	    select_orderline: function(line){
	        if(line){
	            if(line !== this.selected_checkout_orderline){
	                if(this.selected_checkout_orderline){
	                    this.selected_checkout_orderline.set_selected(false);
	                }
	                this.selected_checkout_orderline = line;
	                this.selected_checkout_orderline.set_selected(true);
	            }
	        }else{
	            this.checkout_selected_orderline = undefined;
	        }
	    },
	    add_product: function(product, options) {
            if(this._printed) {
                this.destroy();
                return this.lounge.get_checkout_order().add_product(product, options);
            }

            this.assert_editable();
            options = options || {};
            var attr = JSON.parse(JSON.stringify(product));
            attr.lounge = this.lounge;
	        attr.order = this;

	        var line = new exports.CheckoutOrderline({}, {lounge: this.lounge, checkout_order: this, product: product});

	        if(options.quantity !== undefined) {
	            line.set_quantity(options.quantity);
	        }

	        if(options.price !== undefined){
	            line.set_unit_price(options.price);
	        }

	        if(options.discount !== undefined){
	            line.set_discount(options.discount);
	        }

	        if(options.extras !== undefined){
	            for (var prop in options.extras) {
	                line[prop] = options.extras[prop];
	            }
	        }

	        var last_orderline = this.get_last_orderline();
	        if( last_orderline && last_orderline.can_be_merged_with(line) && options.merge !== false){
	            last_orderline.merge(line);
	        }else {
	            //add checkout orderlines
	            this.checkout_orderlines.add(line);
	        }
	        this.select_orderline(this.get_last_orderline());
	    },
	    get_paymentlines: function() {
	        return this.checkout_paymentlines.models;
	    },
	    get_due: function(checkout_paymentline) {
	        if (!checkout_paymentline) {
	            var due = this.get_total_payment() - this.get_total_paid();
	        } else {
	            var due = this.get_total_payment();
	            var lines = this.checkout_paymentlines.models;
	            for (var i = 0; i < lines.length; i++) {
	                if (lines[i] === checkout_paymentline) {
	                    break;
	                } else {
	                    due -= lines[i].get_amount();
	                }
	            }
	        }

	        return round_pr(Math.max(0,due), this.lounge.currency.rounding);
	    },
	    get_change: function(checkout_paymentline) {
	        if (!checkout_paymentline) {
	            var change = this.get_total_paid() - this.get_total_payment();
	        } else {
	            var change = -this.get_total_payment();
	            var lines  = this.checkout_paymentlines.models;
	            for (var i = 0; i < lines.length; i++) {
	                change += lines[i].get_amount();
	                if (lines[i] === checkout_paymentline) {
	                    break;
	                }
	            }
	        }

	        return round_pr(Math.max(0,change), this.lounge.currency.rounding);
	    },
	    get_total_with_tax: function() {
	        return round_pr(this.get_total_payment(),this.lounge.currency.rounding);
	        //return Math.ceil(this.get_total_without_tax() + this.get_total_tax());
	    },
	    set_last_payment: function(last_payment) {
	        return this.last_payment = last_payment;
	    },
	    get_last_payment: function() {
	        return this.last_payment;
	    },
	    set_total_payment: function(total_payment) {
	        return this.total_payment = total_payment;
	    },
	    get_total_payment: function() {
	        return this.total_payment;
	    },
	    get_total_without_tax: function() {
            return round_pr(this.checkout_orderlines.reduce((function(sum, orderLine) {
                return sum + orderLine.get_price_without_tax();
            }),0), this.lounge.currency.rounding);
	    },
	    get_total_discount: function() {
	        return round_pr(this.checkout_orderlines.reduce((function(sum, orderLine) {
	            return sum + (orderLine.get_unit_price() * (orderLine.get_discount()/100) * orderLine.get_quantity());
	        }), 0), this.lounge.currency.rounding);
	    },
	    get_total_tax: function() {
	        return round_pr(this.checkout_orderlines.reduce((function(sum, orderLine) {
	            return sum + orderLine.get_tax();
	        }), 0), this.lounge.currency.rounding);
            //return round_pr(this.get_total_payment(),this.lounge.currency.rounding);
	    },
        get_total_surcharge: function() {
	        return round_pr(this.checkout_orderlines.reduce((function(sum, orderLine) {
	            return sum + orderLine.get_surcharge();
	        }), 0), this.lounge.currency.rounding);
	    },
	    get_total_paid: function() {
	        return round_pr(this.get_last_payment() + this.get_total_charge_paid(),this.lounge.currency.rounding);
	    },
	    get_total_charge_paid: function() {
	        return round_pr(this.checkout_paymentlines.reduce((function(sum, paymentLine) {
	            return sum + paymentLine.get_amount();
	        }),0),this.lounge.currency.rounding);
	    },
	    get_tax_details: function(){
	        var details = {};
	        var fulldetails = [];

	        this.checkout_orderlines.each(function(line){
	            var ldetails = line.get_tax_details();
	            for(var id in ldetails){
	                if(ldetails.hasOwnProperty(id)){
	                    details[id] = (details[id] || 0) + ldetails[id];
	                }
	            }
	        });

	        for(var id in details){
	            if(details.hasOwnProperty(id)){
	                fulldetails.push({amount: details[id], tax: this.lounge.taxes_by_id[id], name: this.lounge.taxes_by_id[id].name});
	            }
	        }

	        return fulldetails;
	    },
	    get_subtotal : function(){
	        return round_pr(this.checkout_orderlines.reduce((function(sum, orderLine){
	            return sum + orderLine.get_display_price();
	        }), 0), this.lounge.currency.rounding);
	    },
	    remove_paymentline: function(line){
	        this.assert_editable();
	        if(this.selected_checkout_paymentline === line){
	            this.select_paymentline(undefined);
	        }
	        this.checkout_paymentlines.remove(line);
	    },
	    clean_empty_paymentlines: function() {
	        var lines = this.checkout_paymentlines.models;
	        var empty = [];
	        for ( var i = 0; i < lines.length; i++) {
	            if (!lines[i].get_amount()) {
	                empty.push(lines[i]);
	            }
	        }
	        for ( var i = 0; i < empty.length; i++) {
	            this.remove_paymentline(empty[i]);
	        }
	    },
	    remove_orderline: function(line){
	        this.assert_editable();
	        this.checkout_orderlines.remove(line);
	        this.select_orderline(this.get_last_orderline());
	    },
	    /* ---- Order Lines --- */
	    add_orderline: function(line){
	        this.assert_editable();
	        if(line.order){
	            line.order.remove_orderline(line);
	        }
	        line.order = this;
	        this.checkout_orderlines.add(line);
	        this.select_orderline(this.get_last_orderline());
	    },
	    get_orderlines: function(){
	        return this.checkout_orderlines.models;
	    },
	    remove_orderlines() {
	        var lines = this.get_orderlines();
	        this.remove_orderline(lines);
	    },
	    select_paymentline: function(line){
	        if(line !== this.selected_checkout_paymentline){
	            if(this.selected_checkout_paymentline){
	                this.selected_checkout_paymentline.set_selected(false);
	            }
	            this.selected_checkout_paymentline = line;
	            if(this.selected_checkout_paymentline){
	                this.selected_checkout_paymentline.set_selected(true);
	            }
	            this.trigger('change:selected_checkout_paymentline',this.selected_checkout_paymentline);
	        }
	    },
	    /* ---- Payment Lines --- */
	    add_paymentline: function(cashregister) {
	        this.assert_editable();
	        var newPaymentline = new exports.CheckoutPaymentline({},{checkout_order: this, cashregister:cashregister, lounge: this.lounge});
	        if(cashregister.journal.type !== 'cash' || this.lounge.config.iface_precompute_cash){
	            newPaymentline.set_amount( Math.max(this.get_due(),0) );
	        }
	        this.checkout_paymentlines.add(newPaymentline);
	        this.select_paymentline(newPaymentline);
	    },
	    is_paid: function(){
	        return this.get_due() === 0;
	    },
	    is_paid_with_cash: function(){
	        return !!this.checkout_paymentlines.find( function(pl){
	            return pl.cashregister.journal.type === 'cash';
	        });
	    },
	    initialize_validation_date: function () {
	        this.validation_date = this.validation_date || new Date();
	    },
	    remove_orderline: function(line){
	        this.assert_editable();
	        this.checkout_orderlines.remove(line);
	        this.select_orderline(this.get_last_orderline());
	    },
	     /* ---- Screen Status --- */
	    // the order also stores the screen status, as the Lounge supports
	    // different active screens per order. This method is used to
	    // store the screen status.
	    set_screen_data: function(key,value){
	        if(arguments.length === 2){
	            this.screen_data[key] = value;
	        }else if(arguments.length === 1){
	            for(var key in arguments[0]){
	                this.screen_data[key] = arguments[0][key];
	            }
	        }
	    },
	    //see set_screen_data
	    get_screen_data: function(key){
	        return this.screen_data[key];
	    },
	    /* ---- Invoice --- */
	    set_to_invoice: function(to_invoice) {
	        this.assert_editable();
	        this.to_invoice = to_invoice;
	    },
	    is_to_invoice: function(){
	        return this.to_invoice;
	    },
	    finalize: function(){
	        this.destroy();
	    },
	    destroy: function() {
	        Backbone.Model.prototype.destroy.apply(this,arguments);
            //this.lounge.db.remove_checkout_order(this.get_order_id());
	        this.lounge.db.remove_unpaid_checkout_order(this);
	    },
	});

	var CheckoutOrderCollection = Backbone.Collection.extend({
	    model: exports.CheckoutOrder,
	});

	// An order more or less represents the content of a client's shopping cart (the OrderLines)
	// plus the associated payment information (the Paymentlines)
	// there is always an active ('selected') order in the Lounge, a new one is created
	// automaticaly once an order is completed and sent to the server.
	exports.Order = Backbone.Model.extend({
	    initialize: function(attributes,options){
	        Backbone.Model.prototype.initialize.apply(this, arguments);
	        options  = options || {};

	        this.init_locked    = true;
	        this.lounge         = options.lounge;
	        this.selected_orderline   = undefined;
	        this.selected_paymentline = undefined;
	        this.screen_data    = {};  // see Gui
	        this.temporary      = options.temporary || false;
	        this.creation_date  = new Date();
	        this.to_invoice     = false;
	        this.flight_number  = null;
	        this.booking_from_date = null;
	        this.booking_total  = 2;
	        this.orderlines     = new OrderlineCollection();
	        this.paymentlines   = new PaymentlineCollection();
	        this.lounge_session_id = this.lounge.lounge_session.id;
	        this.finalized      = false; // if true, cannot be modified.

	        this.set({
	            client: null,
	            payment_method :null
	         });

	        if (options.json) {
	            this.init_from_JSON(options.json);
	        } else {
	            this.sequence_number = this.lounge.lounge_session.sequence_number++;
	            this.uid  = this.generate_unique_id();
	            this.name = _t("Order ") + this.uid;
	            this.validation_date = undefined;
	        }

	        this.on('change',              function(){ this.save_to_db("order:change"); }, this);
	        this.orderlines.on('change',   function(){ this.save_to_db("orderline:change"); }, this);
	        this.orderlines.on('add',      function(){ this.save_to_db("orderline:add"); }, this);
	        this.orderlines.on('remove',   function(){ this.save_to_db("orderline:remove"); }, this);

	        this.paymentlines.on('change', function(){ this.save_to_db("paymentline:change"); }, this);
	        this.paymentlines.on('add',    function(){ this.save_to_db("paymentline:add"); }, this);
	        this.paymentlines.on('remove', function(){ this.save_to_db("paymentline:rem"); }, this);

	        this.init_locked = false;
	        this.save_to_db();

	        return this;
	    },
	    save_to_db: function(){
	        if (!this.temporary && !this.init_locked) {
	            this.lounge.db.save_unpaid_order(this);
	        }
	    },
	    init_from_JSON: function(json) {
	        var client;
	        var payment_method;
	        this.sequence_number = json.sequence_number;
	        this.lounge.lounge_session.sequence_number = Math.max(this.sequence_number+1,this.lounge.lounge_session.sequence_number);
	        this.session_id    = json.lounge_session_id;
	        this.uid = json.uid;
	        this.name = _t("Order ") + this.uid;
	        this.validation_date = json.creation_date;

	        if (json.fiscal_position_id) {
	            var fiscal_position = _.find(this.pos.fiscal_positions, function (fp) {
	                return fp.id === json.fiscal_position_id;
	            });

	            if (fiscal_position) {
	                this.fiscal_position = fiscal_position;
	            } else {
	                console.error('ERROR: trying to load a fiscal position not available in the lounge');
	            }
	        }

	        if (json.partner_id) {
	            client = this.lounge.db.get_partner_by_id(json.partner_id);
	            if (!client) {
	                console.error('ERROR: trying to load a parner not available in the lounge');
	            }
	        } else {
	            client = null;
	        }

	        if (json.payment_method_id) {
	            var id = json.payment_method_id;
	            var payment_method = null;
                for ( var i = 0; i < this.lounge.cashregisters.length; i++ ) {
                    if ( this.lounge.cashregisters[i].journal_id[0] === id ){
                        payment_method = this.lounge.cashregisters[i];
                        break;
                    }
                }

	            if (!payment_method) {
	                console.error('ERROR: trying to load a payment method not available in the lounge');
	            }
	        } else {
	            payment_method = null;
	        }

	        this.set_client(client);
	        this.set_payment_method(payment_method);

	        this.temporary = false;     // FIXME
	        this.to_invoice = false;    // FIXME



	        var orderlines = json.lines;
	        for (var i = 0; i < orderlines.length; i++) {
	            var orderline = orderlines[i][2];
	            this.add_orderline(new exports.Orderline({}, {lounge: this.lounge, order: this, json: orderline}));
	        }

	        var paymentlines = json.statement_ids;
	        for (var i = 0; i < paymentlines.length; i++) {
	            var paymentline = paymentlines[i][2];
	            var newpaymentline = new exports.Paymentline({},{lounge: this.lounge, order: this, json: paymentline});
	            this.paymentlines.add(newpaymentline);

	            if (i === paymentlines.length - 1) {
	                this.select_paymentline(newpaymentline);
	            }
	        }
	    },
	    export_as_JSON: function() {
	        var orderLines, paymentLines;
	        orderLines = [];
	        this.orderlines.each(_.bind( function(item) {
	            return orderLines.push([0, 0, item.export_as_JSON()]);
	        }, this));
	        paymentLines = [];
	        this.paymentlines.each(_.bind( function(item) {
	            return paymentLines.push([0, 0, item.export_as_JSON()]);
	        }, this));

	        var flight_type = !this.get_flight_type() ? 'domestic' : this.get_flight_type();
	        flight_type = flight_type.toLowerCase();

	        var flight_number = !this.get_flight_number() ? '-' : this.get_flight_number();
	        flight_number = flight_number.toUpperCase();



	        return {
	            name : this.get_name(),
	            flight_type : flight_type,
	            flight_number : flight_number,
	            booking_from_date : this.get_booking_from_date_local(),
	            booking_to_date :  this.get_booking_to_date_local(),
	            booking_total : this.get_booking_total(),
	            amount_surcharge : this.get_total_surcharge(), //add line for write surcharge
	            amount_paid: this.get_total_paid(),
	            amount_total: this.get_total_with_tax(),
	            amount_tax: this.get_total_tax(),
	            amount_return: this.get_change(),
	            lines: orderLines,
	            statement_ids: paymentLines,
	            lounge_session_id: this.lounge_session_id,
	            partner_id: this.get_client() ? this.get_client().id : false,
	            payment_method_id: this.get_payment_method() ? this.get_payment_method().journal_id[0] : false,
	            user_id: this.lounge.cashier ? this.lounge.cashier.id : this.lounge.user.id,
	            uid: this.uid,
	            sequence_number: this.sequence_number,
	            creation_date: this.validation_date || this.creation_date, // todo: rename creation_date in master
	            fiscal_position_id: this.fiscal_position ? this.fiscal_position.id : false
	        };
	    },
	    export_for_printing: function(){
	        var orderlines = [];
	        var self = this;

	        this.orderlines.each(function(orderline){
	            orderlines.push(orderline.export_for_printing());
	        });

	        var paymentlines = [];
	        this.paymentlines.each(function(paymentline){
	            paymentlines.push(paymentline.export_for_printing());
	        });
	        var client  = this.get('client');
	        var payment_method  = this.get('payment_method');
	        var cashier = this.lounge.cashier || this.lounge.user;
	        var company = this.lounge.company;
	        var shop    = this.lounge.shop;
	        var date    = new Date();

	        function is_xml(subreceipt){
	            return subreceipt ? (subreceipt.split('\n')[0].indexOf('<!DOCTYPE QWEB') >= 0) : false;
	        }

	        function render_xml(subreceipt){
	            if (!is_xml(subreceipt)) {
	                return subreceipt;
	            } else {
	                subreceipt = subreceipt.split('\n').slice(1).join('\n');
	                var qweb = new QWeb2.Engine();
	                    qweb.debug = core.debug;
	                    qweb.default_dict = _.clone(QWeb.default_dict);
	                    qweb.add_template('<templates><t t-name="subreceipt">'+subreceipt+'</t></templates>');

	                return qweb.render('subreceipt',{'lounge':self.lounge,'widget':self.lounge.chrome,'order':self, 'receipt': receipt}) ;
	            }
	        }

	        var receipt = {
	            orderlines: orderlines,
	            paymentlines: paymentlines,
	            subtotal: this.get_subtotal(),
	            total_with_tax: this.get_total_with_tax(),
	            total_without_tax: this.get_total_without_tax(),
	            total_surcharge : this.get_total_surcharge(),
	            total_tax: this.get_total_tax(),
	            total_paid: this.get_total_paid(),
	            total_discount: this.get_total_discount(),
	            tax_details: this.get_tax_details(),
	            change: this.get_change(),
	            name : this.get_name(),
	            client: client ? client.name : null ,
	            payment_method: payment_method ? payment_method.name : null ,
	            invoice_id: null,   //TODO
	            cashier: cashier ? cashier.name : null,
	            precision: {
	                price: 2,
	                money: 2,
	                quantity: 3,
	            },
	            date: {
	                year: date.getFullYear(),
	                month: date.getMonth(),
	                date: date.getDate(),       // day of the month
	                day: date.getDay(),         // day of the week
	                hour: date.getHours(),
	                minute: date.getMinutes() ,
	                isostring: date.toISOString(),
	                localestring: date.toLocaleString(),
	            },
	            company:{
	                email: company.email,
	                website: company.website,
	                company_registry: company.company_registry,
	                contact_address: company.partner_id[1],
	                vat: company.vat,
	                name: company.name,
	                phone: company.phone,
	                logo:  this.lounge.company_logo_base64,
	            },
	            shop:{
	                name: shop.name,
	            },
	            currency: this.lounge.currency,
	        };

	        if (is_xml(this.lounge.config.receipt_header)){
	            receipt.header = '';
	            receipt.header_xml = render_xml(this.lounge.config.receipt_header);
	        } else {
	            receipt.header = this.lounge.config.receipt_header || '';
	        }

	        if (is_xml(this.lounge.config.receipt_footer)){
	            receipt.footer = '';
	            receipt.footer_xml = render_xml(this.lounge.config.receipt_footer);
	        } else {
	            receipt.footer = this.lounge.config.receipt_footer || '';
	        }

	        return receipt;
	    },
	    is_empty: function(){
	        return this.orderlines.models.length === 0;
	    },
	    generate_unique_id: function() {
	        // Generates a public identification number for the order.
	        // The generated number must be unique and sequential. They are made 12 digit long
	        // to fit into EAN-13 barcodes, should it be needed

	        function zero_pad(num,size){
	            var s = ""+num;
	            while (s.length < size) {
	                s = "0" + s;
	            }
	            return s;
	        }
	        return zero_pad(this.lounge.lounge_session.id,5) +'-'+
	               zero_pad(this.lounge.lounge_session.login_number,3) +'-'+
	               zero_pad(this.sequence_number,4);
	    },
	    get_name: function() {
	        return this.name;
	    },
	    get_flight_type:function(){
            return this.lounge.get_flight_type();
	    },
	    get_flight_number:function(){
            return this.lounge.get_flight_number();
	    },
	    get_booking_from_date_local: function() {
			if(this.get_booking_from_date()) {
				var date_from = this.get_booking_from_date();
				var dd_from = date_from.substr(0,2);
				var mm_from = date_from.substr(3,2);
				var yy_from = date_from.substr(6,4);
				var hour_from = date_from.substr(11,5);
				return new Date(mm_from + '/' + dd_from + '/' + yy_from + ' ' + hour_from+':00').toUTCString();
			}
			return this.creation_date;
	    },
	    get_booking_to_date_local: function() {
	        if(this.get_booking_from_date_local() && this.get_booking_total()) {
	            var date_to =  moment(this.get_booking_from_date_local()).add(this.get_booking_total(),'hours').format("DD/MM/YYYY HH:MM");
	            var dd_to = date_to.substr(0,2);
				var mm_to = date_to.substr(3,2);
				var yy_to = date_to.substr(6,4);
				var hour_to = date_to.substr(11,5);
				return new Date(mm_to + '/' + dd_to + '/' + yy_to + ' ' + hour_to+':00').toUTCString();
	        }

	        return this.creation_date;
	    },
	    assert_editable: function() {
	        if (this.finalized) {
	            throw new Error('Finalized Order cannot be modified');
	        }
	    },
	    /* ---- Order Lines --- */
	    add_orderline: function(line){
	        this.assert_editable();
	        if(line.order){
	            line.order.remove_orderline(line);
	        }
	        line.order = this;
	        this.orderlines.add(line);
	        this.select_orderline(this.get_last_orderline());
	    },
	    get_orderline: function(id){
	        var orderlines = this.orderlines.models;
	        for(var i = 0; i < orderlines.length; i++){
	            if(orderlines[i].id === id){
	                return orderlines[i];
	            }
	        }
	        return null;
	    },
	    get_orderlines: function(){
	        return this.orderlines.models;
	    },
	    get_last_orderline: function(){
	        return this.orderlines.at(this.orderlines.length -1);
	    },
	    get_tip: function() {
	        var tip_product = this.lounge.db.get_product_by_id(this.lounge.config.tip_product_id[0]);
	        var lines = this.get_orderlines();
	        if (!tip_product) {
	            return 0;
	        } else {
	            for (var i = 0; i < lines.length; i++) {
	                if (lines[i].get_product() === tip_product) {
	                    return lines[i].get_unit_price();
	                }
	            }
	            return 0;
	        }
	    },

	    initialize_validation_date: function () {
	        this.validation_date = this.validation_date || new Date();
	    },

	    set_tip: function(tip) {
	        var tip_product = this.lounge.db.get_product_by_id(this.lounge.config.tip_product_id[0]);
	        var lines = this.get_orderlines();
	        if (tip_product) {
	            for (var i = 0; i < lines.length; i++) {
	                if (lines[i].get_product() === tip_product) {
	                    lines[i].set_unit_price(tip);
	                    return;
	                }
	            }
	            this.add_product(tip_product, {quantity: 1, price: tip });
	        }
	    },
	    remove_orderline: function( line ){
	        this.assert_editable();
	        this.orderlines.remove(line);
	        this.select_orderline(this.get_last_orderline());
	    },

	    add_product: function(product, options){
	        if(this._printed){
	            this.destroy();
	            return this.lounge.get_order().add_product(product, options);
	        }

	        this.assert_editable();
	        options = options || {};
	        var attr = JSON.parse(JSON.stringify(product));
	        attr.lounge = this.lounge;
	        attr.order = this;
	        var line = new exports.Orderline({}, {lounge: this.lounge, order: this, product: product});

	        if(options.quantity !== undefined){

	            line.set_quantity(options.quantity);
	        }
	        if(options.price !== undefined){
	            line.set_unit_price(options.price);
	        }
	        if(options.discount !== undefined){
	            line.set_discount(options.discount);
	        }

	        if(options.extras !== undefined){
	            for (var prop in options.extras) {
	                line[prop] = options.extras[prop];
	            }
	        }

	        var last_orderline = this.get_last_orderline();
	        if( last_orderline && last_orderline.can_be_merged_with(line) && options.merge !== false){
	            last_orderline.merge(line);
	        }else{
	            this.orderlines.add(line);
	        }
	        this.select_orderline(this.get_last_orderline());
	    },
	    get_selected_orderline: function(){
	        return this.selected_orderline;
	    },
	    select_orderline: function(line){
	        if(line){
	            if(line !== this.selected_orderline){
	                if(this.selected_orderline){
	                    this.selected_orderline.set_selected(false);
	                }
	                this.selected_orderline = line;
	                this.selected_orderline.set_selected(true);
	            }
	        }else{
	            this.selected_orderline = undefined;
	        }
	    },
	    deselect_orderline: function(){
	        if(this.selected_orderline){
	            this.selected_orderline.set_selected(false);
	            this.selected_orderline = undefined;
	        }
	    },
	    /* ---- Payment Lines --- */
	    add_paymentline: function(cashregister) {
	        this.assert_editable();
	        var newPaymentline = new exports.Paymentline({},{order: this, cashregister:cashregister, lounge: this.lounge});
	        newPaymentline.set_amount(Math.max(this.get_due(),0) );
	        /*if(cashregister.journal.type !== 'cash' || this.lounge.config.iface_precompute_cash){
	            newPaymentline.set_amount( Math.max(this.get_due(),0) );
	        } else {
	            newPaymentline.set_amount(10.00);
	        }*/

	        this.paymentlines.add(newPaymentline);
	        this.select_paymentline(newPaymentline);

	    },
	    get_paymentlines: function(){
	        return this.paymentlines.models;
	    },
	    remove_paymentline: function(line){
	        this.assert_editable();
	        if(this.selected_paymentline === line){
	            this.select_paymentline(undefined);
	        }
	        this.paymentlines.remove(line);
	    },
	    remove_all_paymentlines:function (){
	        var lines = this.get_paymentlines();
	        for(var i=0; i<lines.length;i++) {
	            this.remove_paymentline(lines[i]);
	        }
	        this.trigger('change:selected_paymentline',true);
	    },
	    clean_empty_paymentlines: function() {
	        var lines = this.paymentlines.models;
	        var empty = [];
	        for ( var i = 0; i < lines.length; i++) {
	            if (!lines[i].get_amount()) {
	                empty.push(lines[i]);
	            }
	        }
	        for ( var i = 0; i < empty.length; i++) {
	            this.remove_paymentline(empty[i]);
	        }

	    },
	    select_paymentline: function(line){
	        if(line !== this.selected_paymentline){
	            if(this.selected_paymentline){
	                this.selected_paymentline.set_selected(false);
	            }
	            this.selected_paymentline = line;
	            if(this.selected_paymentline){
	                this.selected_paymentline.set_selected(true);
	            }
	            this.trigger('change:selected_paymentline',this.selected_paymentline);
	        }
	    },
	    /* ---- Payment Status --- */
	    get_subtotal : function(){
	        return round_pr(this.orderlines.reduce((function(sum, orderLine){
	            return sum + orderLine.get_display_price();
	        }), 0), this.lounge.currency.rounding);
	    },
	    get_total_with_tax: function() {
	        //return this.get_total_without_tax() + this.get_total_tax();
	        return Math.ceil(this.get_total_without_tax() + this.get_total_tax());
	    },
	    get_total_without_tax: function() {
	        return round_pr(this.orderlines.reduce((function(sum, orderLine) {
	            return sum + orderLine.get_price_without_tax();
	        }), 0), this.lounge.currency.rounding);
	    },
	    get_total_discount: function() {
	        return round_pr(this.orderlines.reduce((function(sum, orderLine) {
	            return sum + (orderLine.get_unit_price() * (orderLine.get_discount()/100) * orderLine.get_quantity());
	        }), 0), this.lounge.currency.rounding);
	    },
	    get_total_tax: function() {
	        return round_pr(this.orderlines.reduce((function(sum, orderLine) {
	            return sum + orderLine.get_tax();
	        }), 0), this.lounge.currency.rounding);
	    },

	    get_total_surcharge: function() {
	        return round_pr(this.orderlines.reduce((function(sum, orderLine) {
	            return sum + orderLine.get_surcharge();
	        }), 0), this.lounge.currency.rounding);
	    },
	    get_total_paid: function() {
	        return round_pr(this.paymentlines.reduce((function(sum, paymentLine) {
	            return sum + paymentLine.get_amount();
	        }), 0), this.lounge.currency.rounding);
	    },
	    get_tax_details: function(){
	        var details = {};
	        var fulldetails = [];

	        this.orderlines.each(function(line){
	            var ldetails = line.get_tax_details();
	            for(var id in ldetails){
	                if(ldetails.hasOwnProperty(id)){
	                    details[id] = (details[id] || 0) + ldetails[id];
	                }
	            }
	        });

	        for(var id in details){
	            if(details.hasOwnProperty(id)){
	                fulldetails.push({amount: details[id], tax: this.lounge.taxes_by_id[id], name: this.lounge.taxes_by_id[id].name});
	            }
	        }

	        return fulldetails;
	    },
	    // Returns a total only for the orderlines with products belonging to the category
	    get_total_for_category_with_tax: function(categ_id){
	        var total = 0;
	        var self = this;

	        if (categ_id instanceof Array) {
	            for (var i = 0; i < categ_id.length; i++) {
	                total += this.get_total_for_category_with_tax(categ_id[i]);
	            }
	            return total;
	        }

	        this.orderlines.each(function(line){
	            if ( self.lounge.db.category_contains(categ_id,line.product.id) ) {
	                total += line.get_price_with_tax();
	            }
	        });

	        return total;
	    },
	    get_total_for_taxes: function(tax_id){
	        var total = 0;

	        if (!(tax_id instanceof Array)) {
	            tax_id = [tax_id];
	        }

	        var tax_set = {};

	        for (var i = 0; i < tax_id.length; i++) {
	            tax_set[tax_id[i]] = true;
	        }

	        this.orderlines.each(function(line){
	            var taxes_ids = line.get_product().taxes_id;
	            for (var i = 0; i < taxes_ids.length; i++) {
	                if (tax_set[taxes_ids[i]]) {
	                    total += line.get_price_with_tax();
	                    return;
	                }
	            }
	        });

	        return total;
	    },
	    get_change: function(paymentline) {
	        if (!paymentline) {
	            var change = this.get_total_paid() - this.get_total_with_tax();
	        } else {
	            var change = -this.get_total_with_tax();
	            var lines  = this.paymentlines.models;
	            for (var i = 0; i < lines.length; i++) {
	                change += lines[i].get_amount();
	                if (lines[i] === paymentline) {
	                    break;
	                }
	            }
	        }

	        //var change = this.get_total_paid() - this.get_total_with_tax();
	        return round_pr(Math.max(0,change), this.lounge.currency.rounding);
	    },
	    get_due: function(paymentline) {
	        if (!paymentline) {
	            var due = this.get_total_with_tax() - this.get_total_paid();
	        } else {
	            var due = this.get_total_with_tax();
	            var lines = this.paymentlines.models;
	            for (var i = 0; i < lines.length; i++) {
	                if (lines[i] === paymentline) {
	                    break;
	                } else {
	                    due -= lines[i].get_amount();
	                }
	            }
	        }

	        //var due = this.get_total_with_tax();
	        return round_pr(Math.max(0,due), this.lounge.currency.rounding);
	    },
	    get_total_items: function() {
	        return this.orderlines.reduce((function(sum, orderLine) {
	            return sum + 1;
	        }), 0);
	    },
	    is_paid: function(){
	        return this.get_due() === 0;
	    },
	    is_paid_with_cash: function(){
	        return !!this.paymentlines.find( function(pl){
	            return pl.cashregister.journal.type === 'cash';
	        });
	    },
	    finalize: function(){
	        this.destroy();
	    },
	    destroy: function(){
	        Backbone.Model.prototype.destroy.apply(this,arguments);
	        this.lounge.db.remove_unpaid_order(this);
	    },
	    /* ---- Invoice --- */
	    set_to_invoice: function(to_invoice) {
	        this.assert_editable();
	        this.to_invoice = to_invoice;
	    },
	    is_to_invoice: function() {
	        return this.to_invoice;
	    },
	    /* ---- Client / Customer --- */
	    // the client related to the current order.
	    set_client: function(client){
	        this.assert_editable();
	        this.set('client',client);
	        this.trigger('change',this);

            this.orderlines.map(function (orderLine) {
	            return orderLine.set_refresh();
	         });
	    },
	    get_client: function(){
	        return this.get('client');
	    },
	    get_client_name: function(){
	        var client = this.get('client');
	        return client ? client.name : "";
	    },
	    /* ---- Payment method / Payment --- */
	    // the payment related to the current order.
	    set_payment_method: function(payment_method){
	        this.assert_editable();
	        this.set('payment_method',payment_method);
	        this.trigger('change',this);

            this.orderlines.map(function (orderLine) {
	            return orderLine.set_refresh();
	         });
	    },
	    get_payment_method: function(){
	        return this.get('payment_method');
	    },
	    get_payment_method_name: function(){
	        var payment_method = this.get('payment_method');
	        return payment_method ? payment_method.journal_id[1] : "";
	    },
	    //fligh type
	    set_flight_type : function (flight_type) {
	        this.assert_editable();
	        this.set('flight_type',flight_type);
	    },
	    get_flight_type: function(){
	        return this.get('flight_type');
	    },
	    //fligh type
	    set_flight_number : function (flight_number) {
	        this.assert_editable();
	        this.set('flight_number',flight_number);
	    },
	    get_flight_number: function() {
	        return this.get('flight_number');
	    },
	    set_booking_from_date: function(booking_from_date) {
	        this.assert_editable();
	        this.booking_from_date = booking_from_date;
            //this.set('booking_from_date',booking_from_date);
	    },
	    get_booking_from_date: function() {
	        //return this.get('booking_from_date');
	         return this.booking_from_date;
	    },
	    set_booking_to_date: function(booking_to_date) {
	        this.assert_editable();
            this.set('booking_to_date',booking_to_date);
	    },
	    get_booking_to_date: function() {
	        //return this.get('booking_to_date');
	         return this.booking_total;
	    },
	    set_booking_total: function (booking_total) {
	        this.assert_editable();
	        this.booking_total = booking_total;
	        this.trigger('change',this);

            this.orderlines.map(function (orderLine) {
	            return orderLine.set_refresh();
	         });

	    },
	    get_booking_total: function() {
	        return this.booking_total;
	        //return this.get('booking_total');
	    },

	    /* ---- Screen Status --- */
	    // the order also stores the screen status, as the Lounge supports
	    // different active screens per order. This method is used to
	    // store the screen status.
	    set_screen_data: function(key,value) {
	        if(arguments.length === 2){
	            this.screen_data[key] = value;
	        }else if(arguments.length === 1){
	            for(var key in arguments[0]){
	                this.screen_data[key] = arguments[0][key];
	            }
	        }
	    },
	    //see set_screen_data
	    get_screen_data: function(key){
	        return this.screen_data[key];
	    },
	});

	var OrderCollection = Backbone.Collection.extend({
	    model: exports.Order,
	});

	/*
	 The numpad handles both the choice of the property currently being modified
	 (quantity, price or discount) and the edition of the corresponding numeric value.
	 */
	exports.NumpadState = Backbone.Model.extend({
	    defaults: {
	        buffer: "0",
	        mode: "quantity"
	    },
	    appendNewChar: function(newChar) {
	        var oldBuffer;
	        oldBuffer = this.get('buffer');
	        if (oldBuffer === '0') {
	            this.set({
	                buffer: newChar
	            });
	        } else if (oldBuffer === '-0') {
	            this.set({
	                buffer: "-" + newChar
	            });
	        } else {
	            this.set({
	                buffer: (this.get('buffer')) + newChar
	            });
	        }
	        this.trigger('set_value',this.get('buffer'));
	    },
	    deleteLastChar: function() {
	        if(this.get('buffer') === ""){
	            if(this.get('mode') === 'quantity'){
	                //alert("Alep");
	                this.trigger('set_value','remove');
	            }else{
	                //alert("Alep2");
	                this.trigger('set_value',this.get('buffer'));
	            }
	        }else{
	            //alert("Alepx");
	            var newBuffer = this.get('buffer').slice(0,-1) || "";
	            this.set({ buffer: newBuffer });
	            this.trigger('set_value',this.get('buffer'));
	        }
	    },
	    switchSign: function() {
	        var oldBuffer;
	        oldBuffer = this.get('buffer');
	        this.set({
	            buffer: oldBuffer[0] === '-' ? oldBuffer.substr(1) : "-" + oldBuffer
	        });
	        this.trigger('set_value',this.get('buffer'));
	    },
	    changeMode: function(newMode) {
	        this.set({
	            buffer: "0",
	            mode: newMode
	        });
	    },
	    reset: function() {
	        this.set({
	            buffer: "0",
	            mode: "quantity"
	        });
	    },
	    resetValue: function(){
	        this.set({buffer:'0'});
	    },
	});

	// exports = {
	//     LoungeModel: LoungeModel,
	//     NumpadState: NumpadState,
	//     load_fields: load_fields,
	//     load_models: load_models,
	//     Orderline: Orderline,
	//     Order: Order,
	// };
	return exports;

});
