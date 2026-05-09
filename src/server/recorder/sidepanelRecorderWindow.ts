/**
 * Copyright (c) Rui Figueira.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { RecorderEventData, RecorderMessage, RecorderWindow } from './crxRecorderApp';

export class SidepanelRecorderWindow implements RecorderWindow {
  private static _activeWindow?: SidepanelRecorderWindow;
  private _recorderUrl: string;
  private _portPromise: Promise<chrome.runtime.Port>;
  private _resolvePort?: (port: chrome.runtime.Port) => void;
  private _port?: chrome.runtime.Port;
  private _closed = true;
  private _disposed = false;
  private _onConnect: (port: chrome.runtime.Port) => void;
  onMessage?: (({ type, event, params }: RecorderEventData) => void) | undefined;
  hideApp?: (() => any) | undefined;

  constructor(recorderUrl?: string) {
    SidepanelRecorderWindow._activeWindow?._disposeStaleConnection();
    SidepanelRecorderWindow._activeWindow = this;
    this._recorderUrl = recorderUrl ?? 'index.html';
    this._portPromise = this._nextPortPromise();
    this._onConnect = this._handleConnect.bind(this);
    chrome.runtime.onConnect.addListener(this._onConnect);
  }

  isClosed(): boolean {
    return this._closed;
  }

  postMessage(msg: RecorderMessage) {
    if (this._port) {
      try {
        this._port.postMessage({ ...msg });
        return;
      } catch {
        this._port = undefined;
      }
    }
    this._portPromise.then(port => port.postMessage({ ...msg })).catch(() => {});
  }

  async open() {
    await chrome.sidePanel.setOptions({ path: this._recorderUrl });
    await this._portPromise;
    this._closed = false;
  }

  async focus() {
  }

  async close() {
    if (this._disposed)
      return;
    this._disposed = true;
    this._closed = true;
    chrome.runtime.onConnect.removeListener(this._onConnect);
    try {
      this._port?.disconnect();
    } catch {
    }
    if (SidepanelRecorderWindow._activeWindow === this)
      SidepanelRecorderWindow._activeWindow = undefined;
    this._port = undefined;
    this._portPromise = this._nextPortPromise();
    this.hideApp?.();
  }

  private _nextPortPromise(): Promise<chrome.runtime.Port> {
    return new Promise(resolve => this._resolvePort = resolve);
  }

  private _handleConnect(port: chrome.runtime.Port) {
    if (this._disposed)
      return;
    if (port.name && port.name !== 'recorder')
      return;
    if (this._port && this._port !== port) {
      try {
        this._port.disconnect();
      } catch {
      }
    }

    this._port = port;
    this._closed = false;
    port.onDisconnect.addListener(() => {
      if (this._port !== port)
        return;
      this._port = undefined;
      this._closed = true;
      this._portPromise = this._nextPortPromise();
    });
    port.onMessage.addListener(message => this.onMessage?.(message));
    this._resolvePort?.(port);
    this._resolvePort = undefined;
    try {
      port.postMessage({
        type: 'recorder',
        method: 'runtimeEvent',
        event: {
          type: 'runtime.port-server-connected',
          message: 'recorder app 已接管 side panel 运行通道',
          data: { portName: port.name },
        },
      });
    } catch {
    }
  }

  private _disposeStaleConnection() {
    this._disposed = true;
    this._closed = true;
    chrome.runtime.onConnect.removeListener(this._onConnect);
    try {
      this._port?.disconnect();
    } catch {
    }
    this._port = undefined;
  }
}
