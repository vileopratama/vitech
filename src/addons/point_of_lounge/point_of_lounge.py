from openerp.osv import fields, osv

class lounge_config(osv.osv):
    _name = 'lounge.config'
    LOUNGE_CONFIG_STATE = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('deprecated', 'Deprecated')
    ]

    _columns = {
        'name': fields.char('Lounge Name', select=1,required=True, help="An internal identification of the point of lounge"),
        #'stock_location_id': fields.many2one('stock.location', 'Stock Location', domain=[('usage', '=', 'internal')],required=True),
        'state': fields.selection(LOUNGE_CONFIG_STATE, 'Status', required=True, readonly=True, copy=False),
    }

    # def _get_default_location(self, cr, uid, context=None):
    #    wh_obj = self.pool.get('stock.warehouse')
    #    user = self.pool.get('res.users').browse(cr, uid, uid, context)
     #   res = wh_obj.search(cr, uid, [('company_id', '=', user.company_id.id)], limit=1, context=context)
     #   if res and res[0]:
     #       return wh_obj.browse(cr, uid, res[0], context=context).lot_stock_id.id
     #   return Fals

    _defaults = {
        'state': LOUNGE_CONFIG_STATE[0][0],
        #'stock_location_id': _get_default_location,
    }


