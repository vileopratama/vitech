from openerp import models, fields

class ResPartner(models.Model):
    _inherit = 'res.partner'
    sector_id = fields.Many2one(comodel_name='res.partner.sector',string='Sector')