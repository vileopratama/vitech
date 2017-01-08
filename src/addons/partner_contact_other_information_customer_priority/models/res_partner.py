from openerp import models,fields

class ResPartner(models.Model):
    _inherit = 'res.partner'
    customer_priority = fields.Selection([('yes','Yes'),('no','No')])
