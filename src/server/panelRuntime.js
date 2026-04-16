const { EventEmitter } = require("node:events");
const { buildDefaultSettings, sanitizeSettings } = require("../main/configStore");
const { NullPushGateway, NullCloudGateway } = require("./integrationPorts");

class PanelRuntime extends EventEmitter {
  constructor({
    configStore,
    positionsService,
    equityHistoryService,
    equityAlertService,
    pushGateway,
    cloudGateway
  }) {
    super();
    this.configStore = configStore;
    this.positionsService = positionsService;
    this.equityHistoryService = equityHistoryService;
    this.equityAlertService = equityAlertService;
    this.pushGateway = pushGateway || new NullPushGateway();
    this.cloudGateway = cloudGateway || new NullCloudGateway();
    this.started = false;

    this.handleSnapshot = this.handleSnapshot.bind(this);
    this.handleHistoryUpdated = this.handleHistoryUpdated.bind(this);
  }

  async start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.positionsService.on("snapshot", this.handleSnapshot);
    this.equityHistoryService.on("history-updated", this.handleHistoryUpdated);
    this.equityHistoryService.start();
    await this.connectWithSavedSettings();
  }

  async dispose() {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.positionsService.removeListener("snapshot", this.handleSnapshot);
    this.equityHistoryService.removeListener("history-updated", this.handleHistoryUpdated);
    this.positionsService.dispose();
    this.equityHistoryService.dispose();
  }

  getSettings() {
    return sanitizeSettings(this.configStore.load());
  }

  getDefaultSettings() {
    return sanitizeSettings(buildDefaultSettings());
  }

  getSnapshot() {
    return this.positionsService.getSnapshot();
  }

  getHistory() {
    return this.equityHistoryService.getHistory(this.configStore.load(), this.positionsService.getSnapshot());
  }

  exportHistoryCsv(intervalMinutes) {
    return this.equityHistoryService.exportHistoryCsv(this.configStore.load(), intervalMinutes);
  }

  getHistoryStorageDirectory() {
    return this.equityHistoryService.getStorageDirectory(this.configStore.load());
  }

  async saveSettings(payload) {
    const settings = this.configStore.save(payload);
    this.positionsService.hydrateFromSettings(settings);
    this.equityHistoryService.noteSnapshot(settings, this.positionsService.getSnapshot());
    await this.cloudGateway.syncSettings(settings);

    if (settings.apiKey && settings.apiSecret) {
      await this.positionsService.start(settings);
    } else {
      this.positionsService.stop({ emitSnapshot: true });
    }

    return {
      settings: sanitizeSettings(settings),
      snapshot: this.positionsService.getSnapshot()
    };
  }

  async refresh() {
    const settings = this.configStore.load();
    this.positionsService.hydrateFromSettings(settings);

    if (settings.apiKey && settings.apiSecret) {
      await this.positionsService.start(settings);
    }

    const snapshot = this.positionsService.getSnapshot();
    this.equityHistoryService.noteSnapshot(settings, snapshot);
    return snapshot;
  }

  async connectWithSavedSettings() {
    const settings = this.configStore.load();
    this.positionsService.hydrateFromSettings(settings);
    this.equityHistoryService.noteSnapshot(settings, this.positionsService.getSnapshot());

    if (settings.apiKey && settings.apiSecret) {
      await this.positionsService.start(settings);
    }
  }

  handleSnapshot(snapshot) {
    const settings = this.configStore.load();
    this.equityHistoryService.noteSnapshot(settings, snapshot);
    this.emit("snapshot", snapshot);
    Promise.allSettled([
      this.pushGateway.publish("snapshot", snapshot),
      this.cloudGateway.syncSnapshot(snapshot)
    ]).catch(() => {});
  }

  handleHistoryUpdated(historyPayload) {
    this.emit("history-updated", historyPayload);
    Promise.allSettled([
      this.pushGateway.publish("history-updated", historyPayload),
      this.cloudGateway.syncHistory(historyPayload)
    ]).catch(() => {});

    const settings = this.configStore.load();
    const alertPayload = this.equityAlertService.evaluate(settings, historyPayload);
    if (!alertPayload) {
      return;
    }

    this.emit("alert", alertPayload);
    Promise.allSettled([
      this.pushGateway.publish("alert", alertPayload),
      this.cloudGateway.syncAlert(alertPayload)
    ]).catch(() => {});
  }
}

module.exports = {
  PanelRuntime
};
