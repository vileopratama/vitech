from openerp.osv import fields, osv

class pos_cashier(osv.osv):
    _name = 'pos.cashier'
    _order = 'cashier_name asc'
    _columns = {
        'pos_config_id': fields.many2one('pos.config', 'Point Of Sale', required=True),
        'cashier_name': fields.char('Cashier', size=128, required=True),
        'active': fields.boolean('Active', help="If a cashier is not active, it will not be displayed in POS"),
    }
    _defaults = {
        'cashier_name': '',
        'active': True,
        'pos_config_id': lambda self, cr, uid, c: self.pool.get('res.users').browse(cr, uid, uid, c).pos_config.id,
    }
    _sql_constraints = [
        ('uniq_name', 'unique(cashier_name, pos_config_id)',
         "A cashier already exists with this name in this Point Of sale. Cashier's name must be unique!"),
    ]