from openerp.osv import osv,fields

class res_users(osv.osv):
    _inherit = 'res.users'
    _columns = {
        'lounge_security_pin': fields.char('Security PIN', size=32,help='A Security PIN used to protect sensible functionality in the Lounge'),
        'lounge_config': fields.many2one('lounge.config', 'Default Lounge', domain=[('state', '=', 'active')]),
    }

    def _check_pin(self, cr, uid, ids, context=None):
	    for user in self.browse(cr, uid, ids, context=context):
		    if user.lounge_security_pin and not user.lounge_security_pin.isdigit():
			    return False
	    return True

    _constraints = [
	    (_check_pin, "Security PIN can only contain digits", ['lounge_security_pin']),
    ]





