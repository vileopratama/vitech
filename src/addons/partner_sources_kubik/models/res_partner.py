from openerp import models, fields

class ResPartner(models.Model):
    _inherit = 'res.partner'
    source_id = fields.Many2one(comodel_name='res.partner.sources',string='From Sources')