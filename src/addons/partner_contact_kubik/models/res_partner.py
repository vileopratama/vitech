from openerp import models,fields

class ResPartner(models.Model) :
    _inherit = 'res.partner'
    birthdate = fields.Date(string="Birthdate")
    branch = fields.Char(string="Branch")
    division = fields.Char(string="Division")
    employee_total = fields.Char(string="Employee Total")
    customer_from = fields.Selection([("Mandiri", "Mandiri"), ("Manajemen", "Manajemen")],
                              string="From")
    status = fields.Selection([("Prospek Client","Prospek Client"),("Existing Client","Existing Client")],string="Status")
    group_status = fields.Selection([('Cold', 'Cold'),
                                     ('Hot', 'Hot'),
                                     ('Not Qualifed', 'Not Qualifed'),
                                     ('Warm','Warm')],
                                    string="Group Status")
    phone_ext = fields.Char(string="Phone Extension")
    # pic 01 selection
    pic_1_name = fields.Char(required=True,string="HR PIC 1")
    pic_1_birthdate = fields.Date(string="Birthdate")
    pic_1_position = fields.Char(string="Position")
    pic_1_mobile = fields.Char(required=True, string="Mobile")
    pic_1_email = fields.Char(string="Email")
    pic_1_note = fields.Text(string = "Note")
    # pic 02 selection
    pic_2_name = fields.Char(string="HR PIC 2")
    pic_2_birthdate = fields.Date(string="Birthdate")
    pic_2_position = fields.Char(string="Position")
    pic_2_mobile = fields.Char(string="Mobile")
    pic_2_email = fields.Char(string="Email")
    pic_2_note = fields.Text(string="Note")
