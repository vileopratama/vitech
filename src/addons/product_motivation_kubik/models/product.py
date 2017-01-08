from openerp import models, fields

class product_template(models.Model):
    _inherit = 'product.template'
    total_duration = fields.Char(string = "Total Duration")