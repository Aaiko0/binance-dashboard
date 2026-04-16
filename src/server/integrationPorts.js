class PushGateway {
  async publish(_eventName, _payload) {}
}

class CloudGateway {
  async syncSettings(_settings) {}

  async syncSnapshot(_snapshot) {}

  async syncHistory(_historyPayload) {}

  async syncAlert(_alertPayload) {}
}

class NullPushGateway extends PushGateway {}

class NullCloudGateway extends CloudGateway {}

module.exports = {
  PushGateway,
  CloudGateway,
  NullPushGateway,
  NullCloudGateway
};
