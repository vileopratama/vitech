from openerp import fields,models

class ResPartnerSources(models.Model):
    _name = 'res.partner.sources'
    _order = "name"
    _description = "Source Name"
    name = fields.Char(required=True, translate=True)
