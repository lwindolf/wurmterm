// vim: set ts=4 sw=4:

import { Settings } from './settings.js';

/* WurmTerm backend singleton, allowing one host being probed at a time.
   Manages auto-updates, host discovery and probe dependency tree  */

class WurmTermBackend {
	// settings defaults
	static defaultEndpoint = 'ws://localhost:8181/wurmterm';
	static defaultProbeBlacklist = [];
	static defaultRefreshInterval = 30;
	static defaultHistoryRefreshInterval = 10;
	static defaultHostProbing = true;
	static defaultKubectxtProbing = true;
	static defaultAutoStart = false;

	// state
	static #status = {
		// state machine 1->2->3->4
		started     : false,			// (1) true if connect was started
		connected   : false,			// (2) true once connected
		auth        : false,			// (3) true once auth is done
		ready       : false,        	// (4) true if WurmTerm is ready for the user

		// error state
		authFailure : false,			// true if credentials were wrong
		error       : "Uninitialized"	// Human readable error string to display
	}
	static runs = {};					// promises for dedicated command runs (e.g. from notebook)
	static ws;							// websocket
	static connectTimeout;

	// data
	static probes = {};					// definition of probes
	static history = {};				// history of hosts and kubectl contexts
	static results = {};				// connected hosts and kubectxt and their callbacks and results
	static localnet = {};				// local network discovery results

	static #staticConstructor = (function() {
		WurmTermBackend.history.hosts = [];
		WurmTermBackend.history.kubectxt = [];
		WurmTermBackend.results.hosts = {};
		WurmTermBackend.results.kubectxt = {};

		Settings.get('WurmTermAutoStart', WurmTermBackend.defaultAutoStart)
		.then((autostart) => {
			if(autostart) {
				console.log("WurmTermBackend: auto start");
				WurmTermBackend.connect();
			}
		});
	})();

	static getStatus() {
		return this.#status;
	}

	static #stateChanged(changes) {
		let msg = "";

		this.#status = {...this.#status, ...changes};
		this.#status.ready = this.#status.connected && this.#status.auth;

		if (!this.#status.connected)
			msg = "Connecting...";
		else if(!this.#status.auth && !this.#status.error)
			msg = "Authenticating...";
		else if(this.#status.error)
			msg += " ⛔ " + this.#status.error;
		else if (this.#status.ready)
			msg = "✅ Ready.";
		else
			msg = "Unknown state!"

		console.log("WurmTermBackend: "+msg);
		document.dispatchEvent(new CustomEvent('WurmTermBackendStatus', {
			detail: {
				...this.#status,
				msg
			}
		}));
	}

	static reconnect() {
		this.ws = undefined;
		this.#stateChanged({
			ready     : false,
			connected : false,
			auth      : false,
			// do not reset authFailure / error message here to ensure it stays visible while reconnecting
		});

		if (this.connectTimeout)
			clearTimeout(this.connectTimeout);

		this.connectTimeout = setTimeout(function () { WurmTermBackend.connect(); }, 5000);
	}

	static isReady() {
		return this.#status.ready;
	}

	static async connect() {
		let a = WurmTermBackend;

		if (a.ws)
			return;

		try {
			a.#stateChanged({ started: true });

			let endpoint = await Settings.get('WurmTermBackendEndpoint', this.defaultEndpoint);
			let ws = new WebSocket(endpoint);
			ws.onerror = function (e) {
				a.#stateChanged({ error: "Backend websocket error!" });
				a.reconnect();
			};
			ws.onclose = function (e) {
				a.#stateChanged({ error: "Backend websocket not available!" });
				a.reconnect();
			};
			ws.onmessage = function (e) {
				try {
					let d = JSON.parse(e.data);
					if (d.cmd === 'auth') {
						if (d.result == 0) {
							a.#stateChanged({
								auth        : true,
								authFailure : false,
								error       : undefined
							});
							a.updateHosts();
							ws.send("probes");
							ws.send("history");
							ws.send("kubectxt");
							ws.send("localnet");
						} else {
							a.#stateChanged({
								auth        : false,
								authFailure : true,
								error       : "Authentication failed!"
							});
						}
					}
					if (d.cmd === 'history') {
						if(d.result)
							a.history.hosts = d.result;
						else
							console.error("Invalid hosts history data received from backend!");
						document.dispatchEvent(new CustomEvent('WurmTermBackendHistoryUpdate', { detail: a.history }));
					}
					if (d.cmd === 'kubectxt') {
						console.log("Received kubectxt history:", d);
						if(d.result)
							a.history.kubectxt = d.result;
						else
							console.error("Invalid kubectxt history data received from backend!");
						document.dispatchEvent(new CustomEvent('WurmTermBackendHistoryUpdate', { detail: a.history }));
					}
					if (d.cmd === 'localnet') {
						a.localnet = d.result;
						document.dispatchEvent(new CustomEvent('WurmTermBackendLocalNetUpdate', { detail: a.localnet }));
					}
					if (d.cmd === 'hosts') {
						a.#updateHostsCb(d.result);
						document.dispatchEvent(new CustomEvent('WurmTermBackendHostsUpdate', { detail: d.result }));
					}
					if (d.cmd === 'probes') {
						a.probes = d.result;
						document.dispatchEvent(new CustomEvent('WurmTermBackendProbesUpdate', { detail: d.result }));
					}

					if (d.cmd === 'run') {
						let p = a.runs[d.id];

						if (undefined === p) {
							console.error(`Message ${d} misses id info or does not match known run!`);
						} else {
							if (undefined === d.error)
								p.resolve(d);
							else
								p.reject(d);
						}
						document.dispatchEvent(new CustomEvent('WurmTermBackendRunResult', { detail: d }));
					}

					if (d.cmd === 'probe') {
						let p = a.results.hosts[d.host]?.probes[d.probe];

						if (undefined === p) {
							console.error(`Message ${d} misses probe info or does not match known probe!`);
						} else {
							p.updating = false;
							p.timestamp = Date.now();
							p.result = d;

							if (undefined === d.error) {
								// Always trigger follow probes, serialization is done in backend
								for (var n in d.next) {
									ws.send(`${d.host}:::${d.next[n]}`);
								}

								// Calculate probe severity
								d.probeSeverity = 'normal';

								if (d.stdout.length == 0)
									d.probeSeverity = 'empty';
								else if (d?.render?.severity) {
									for (const line of JSON.stringify(d.stdout).split(/\\n/)) {
										const severity = a.#multiMatch(line, d.render.severity);
										switch (severity) {
											case 'critical':
												d.probeSeverity = 'critical';
											case 'warning':
												if (d.probeSeverity != 'critical')
													d.probeSeverity = 'warning';
										}
									}
								}

								// Aggregate probe severities and flag host as having problems or not
								a.results.hosts[d.host].probes[d.probe] = d;
								if (d.probeSeverity === 'critical' ||
									d.probeSeverity === 'warning')
									a.results.hosts[d.host].problems = true;

									document.dispatchEvent(new CustomEvent('WurmTermProbeResult', { detail: d }));
							} else {
								document.dispatchEvent(new CustomEvent('WurmTermProbeError', { detail: d }));
							}
						}
					}
				} catch (ex) {
					console.error(`Exception: ${ex}\nMessage: ${JSON.stringify(ex)}`);
				}
			};
			ws.onopen = async (e) => {
				a.#stateChanged({ connected: true });
				ws.send("auth " + await Settings.get('WurmTermBackendPassword', ''));
			};
			a.ws = ws;
		} catch (e) {
			a.#stateChanged({ error: e });
			a.reconnect();
		}
	};

	// evaluate a single-line text against multiple severity regex pattern
	static #multiMatch(line, severities) {
		let matchResult;
		for (const name of ['critical', 'warning']) {
			if (!(name in severities))
				continue;

			const re = new RegExp(severities[name], 'i');
			const matches = re.exec(line);
			if (matches) {
				matchResult = name;
				break;
			}
		};
		return matchResult;
	}

	static getResults() {
		return WurmTermBackend.results;
	}

	static getLocalNet() {
		return WurmTermBackend.localnet;
	}

	static getHistory() {
		// filter for current connections
		return {
			hosts    : WurmTermBackend.history.hosts.filter((h) => !(h in WurmTermBackend.results.hosts)),
			kubectxt : WurmTermBackend.history.kubectxt.filter((c) => !(c in WurmTermBackend.results.kubectxt))
		}
	}

	static getProbeByName(name) {
		return WurmTermBackend.probes[name];
	};

	// Setup periodic host update fetch and callback
	static async updateHosts() {
		let a = WurmTermBackend;

		try {
			a.ws.send(`hosts`);
			a.ws.send("status");	// FIXME remove me
		} catch (e) { }

		if (a.updateHostsTimeout)
			clearTimeout(a.updateHostsTimeout);

		a.updateHostsTimeout = setTimeout(() => {
			a.updateHosts();
		}, (await Settings.get('WurmTermHistoryRefreshInterval', WurmTermBackend.defaultHistoryRefreshInterval)) * 1000);
	}

	static async #updateHostsCb(hosts) {
		let a = WurmTermBackend;
		let oldHosts = Object.keys(a.results.hosts);

		if (await Settings.get('WurmTermHostProbing', a.defaultHostProbing)) {
			let newHosts = hosts.filter(x => !oldHosts.includes(x));
			let disconnected = oldHosts.filter(x => !hosts.includes(x));

			for (const h of newHosts) {
				a.start(h);
			}

			for (const h of disconnected) {
				a.stop(h);
			}
		}
	};

	// Run a given command and return a promise for result processing
	static run(host, id, cmd) {
		let a = WurmTermBackend;

		return new Promise((resolve, reject) => {
			a.runs[id] = { resolve: resolve, reject: reject };
			a.ws.send(`run ${host}:::${id}:::${cmd}`);
		});
	};

	// Perform a given probe and call callback cb for result processing
	static async probe(host, name) {
		let a = WurmTermBackend;

		// Never run disabled probes
		if ((await Settings.get('WurmTermProbeBlacklist', this.defaultProbeBlacklist)).includes(name))
			return;

		// Never run exclusively local commands elsewhere automatically
		if (host !== 'localhost' && a.probes[name].localOnly === 'True')
			return;

		if (undefined === a.results.hosts[host].probes[name])
			a.results.hosts[host].probes[name] = {};

		let p = a.results.hosts[host].probes[name];
		p.updating = true;
		p.timestamp = Date.now();

		a.ws.send(`probe ${host}:::${name}`);
	};

	// Triggers the initial probes, all others will be handled in the
	// update method
	static startProbes(host) {
		let a = WurmTermBackend;
		a.results.hosts[host] = { probes: {} };

		Object.keys(a.probes).forEach(function (p) {
			if (a.probes[p].initial)
				a.probe(host, p);
		});
	};

	// Start probing a given host, handles initial probe list fetch
	// Ensures to stop previous host probes.
	static start(host, cb, errorCb) {
		this.startProbes(host);
		this.update(host);
	};

	// Stop probes for given host
	static stop(host) {
		delete this.results.hosts[host];
	}

	// Stop all probing
	static stopAll() {
		if (WurmTermBackend.updateTimer)
			clearTimeout(WurmTermBackend.updateTimer);

		WurmTermBackend.updateTimer = undefined;

		this.results.hosts = {};
	};

	static async update(host) {
		let a = WurmTermBackend;
		let now = Date.now();
		a.updateTimer = setTimeout(a.update.bind(a), (await Settings.get('WurmTermRefreshInterval', this.defaultRefreshInterval)) * 1000);
		for (const name of Object.keys(this.probes)) {
			let p = this.probes[name];

			// On localhost run all local commands
			if (host === 'localhost' && p.local !== 'True')
				return;

			if (p.updating === false && p.refresh * 1000 < now - p.timestamp)
				a.probe(name);
		};
	};
}

export { WurmTermBackend };