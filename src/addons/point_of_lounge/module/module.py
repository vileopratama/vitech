from openerp.osv import fields, osv

class module_category(osv.osv):
    _inherit = "ir.module.category"
    _description = "Application"
    _order = 'name'
    _defaults = {
	    'visible': 1,
    }