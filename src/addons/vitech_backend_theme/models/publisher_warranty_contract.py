# -*- coding: utf-8 -*-
from openerp import api, models

class publisher_warranty_contract(models.AbstractModel):
    _inherit = 'publisher_warranty.contract'
    @api.multi
    def update_notification(self, cron_mode=True, context=None):
        pass