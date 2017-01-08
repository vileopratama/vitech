from openerp import models, fields

class ResPartner(models.Model):
    _inherit = 'res.partner'
    linked_ta_user_id = fields.Many2one(comodel_name='res.users',string='TA User')