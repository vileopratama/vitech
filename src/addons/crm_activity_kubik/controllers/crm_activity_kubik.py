from openerp.addons.base.res.res_partner import format_address
from openerp.osv import fields, osv

class crm_activity_kubik(osv.osv):
    _name = "crm.activity.kubik"
    _description = "CRM Activity for Kubik"
    _order = "date asc"
    _columns = {
        'partner_id': fields.many2one('res.partner', 'Partner', ondelete='set null', track_visibility='onchange',
                                      select=True,
                                      help="Linked partner (optional). Usually created when converting the lead."),
        'date': fields.datetime(string ="Date",readonly=False),
        'type': fields.selection(
            [('Call', 'Call'), ('Presentation', 'Presentation')],
            string='Type', select=True, required=True, help="Type is used to separate Activity"),
        'location': fields.char('Location', required=True, select = 1,size = 200),
        'people': fields.char('People', required=True, select=1, size=200),
        'objective': fields.char('Objective', required=True, select=1, size=200),
        'result': fields.char('Result', required=True, select=1, size=200),
        'follow_up': fields.selection(
            [('Offering', 'Offering'), ('Deal', 'Deal'),('Failed','Failed')],
            string='Follow Up', select=True, required=True,
            help="Follow up is used to separate Activity"),
        'description': fields.text('Description'),
    }