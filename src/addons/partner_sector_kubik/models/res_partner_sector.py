from openerp import fields,models

class ResPartnerSector(models.Model):
    _name = 'res.partner.sector'
    _order = "name"
    #_parent_order = "name"
    #_parent_store = True
    _description = "Sector"

    name = fields.Char(required=True, translate=True)
    #parent_id = fields.Many2one(comodel_name='res.partner.sector', ondelete='restrict',string='Parent')
    #child_ids = fields.One2many(comodel_name='res.partner.sector',
                                #inverse_name='parent_id',
                                #string="Children")
    #parent_left = fields.Integer('Parent Left', select=True)
    #parent_right = fields.Integer('Parent Right', select=True)
