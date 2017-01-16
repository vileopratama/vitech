import logging
from openerp import http
from openerp.http import request

_logger = logging.getLogger(__name__)

class LoungeController(http.Controller):
	@http.route('/lounge/cashier', type='http', auth='user')
	def a(self, debug=False, **k):
		return request.render('point_of_lounge.index')

