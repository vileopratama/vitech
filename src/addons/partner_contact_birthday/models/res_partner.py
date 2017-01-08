from openerp  import fields,models

class ResPartner(models.Model):
    _inherit = 'res.partner'
    birthday = fields.Date()