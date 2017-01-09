import controllers
import models

from openerp.tools.misc import upload_data_thread
upload_data_thread.run = lambda x: None