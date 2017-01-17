# -*- coding: utf-8 -*-
import logging
import werkzeug.utils

from openerp import http
from openerp.http import request

_logger = logging.getLogger(__name__)


class LoungeController(http.Controller):
    @http.route('/lounge/cashier', type='http', auth='user')
    def a(self, debug=False, **k):
        cr, uid, context, session = request.cr, request.uid, request.context, request.session
        # if user not logged in, log him in
        LoungeSession = request.registry['lounge.session']
        lounge_session_ids = LoungeSession.search(cr, uid, [('state', '=', 'opened'), ('user_id', '=', session.uid)],context=context)
        if not lounge_session_ids:
            return werkzeug.utils.redirect('/web#action=point_of_lounge.action_client_lounge_menu')
        LoungeSession.login(cr, uid, lounge_session_ids, context=context)

        return request.render('point_of_lounge.index')

