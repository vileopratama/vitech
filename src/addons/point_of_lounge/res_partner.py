from openerp.osv import osv, fields


class ResPartner(osv.osv):
    _inherit = 'res.partner'
    _columns = {
        'lounge_barcode': fields.char('Barcode', help="BarCode", oldname='ean13'),
        'pic': fields.char(string='Personal In Contact',size=100),
        'disc_product': fields.float(string='Disc(Product)')
    }
    _defaults = {
        'disc_product': 0
    }
