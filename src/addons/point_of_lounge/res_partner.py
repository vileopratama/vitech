from openerp.osv import osv, fields


class res_partner(osv.osv):
    _inherit = 'res.partner'
    _columns = {
        'lounge_barcode' : fields.char('Barcode', help="BarCode", oldname='ean13'),
    }