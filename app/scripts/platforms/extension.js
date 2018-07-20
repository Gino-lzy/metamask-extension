const extension = require('extensionizer')
const explorerLink = require('etherscan-link').createExplorerLink

class ExtensionPlatform {

  //
  // Public
  //
  reload () {
    extension.runtime.reload()
  }

  openWindow ({ url }) {
    extension.tabs.create({ url })
  }

  getVersion () {
    return extension.runtime.getManifest().version
  }

  openExtensionInBrowser () {
    const extensionURL = extension.runtime.getURL('home.html')
    this.openWindow({ url: extensionURL })
  }

  getPlatformInfo (cb) {
    try {
      extension.runtime.getPlatformInfo((platform) => {
        cb(null, platform)
      })
    } catch (e) {
      cb(e)
    }
  }

  showTransactionNotification (txMeta) {

    const status = txMeta.status
    if (status === 'confirmed') {
      this._showConfirmedTransaction(txMeta)
    } else if (status === 'failed') {
      this._showFailedTransaction(txMeta)
    } else if (status === 'dropped') {
      this._showDroppedTransaction(txMeta)
    }
  }

  _showConfirmedTransaction (txMeta) {

    this._subscribeToNotificationClicked()

    const url = explorerLink(txMeta.hash, parseInt(txMeta.metamaskNetworkId))
    const nonce = parseInt(txMeta.txParams.nonce, 16)

    const title = 'Confirmed transaction'
    const message = `Transaction ${nonce} confirmed! View on EtherScan`
    this._showNotification(title, message, url)
  }

  _showFailedTransaction (txMeta) {

    const nonce = parseInt(txMeta.txParams.nonce, 16)
    const title = 'Failed transaction'
    const message = `Transaction ${nonce} failed! ${txMeta.err.message}`
    this._showNotification(title, message)
  }

  _showDroppedTransaction (txMeta) {

    const nonce = parseInt(txMeta.txParams.nonce, 16)
    const title = 'Dropped transaction'
    const message = `Transaction ${nonce} was dropped, because another transaction with that number was successfully processed.`
    this._showNotification(title, message)
  }

  _showNotification (title, message, url) {
    extension.notifications.create(
      url,
      {
      'type': 'basic',
      'title': title,
      'iconUrl': extension.extension.getURL('../../images/icon-64.png'),
      'message': message,
      })
  }

  _subscribeToNotificationClicked () {
    if (!extension.notifications.onClicked.hasListener(this._viewOnEtherScan)) {
      extension.notifications.onClicked.addListener(this._viewOnEtherScan)
    }
  }

  _viewOnEtherScan (txId) {
    if (txId.startsWith('http://')) {
      global.metamaskController.platform.openWindow({ url: txId })
    }
  }
}

module.exports = ExtensionPlatform
