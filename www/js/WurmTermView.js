// vim: set ts=4 sw=4:

import { Runbook } from "./runbook.js";
import { WurmTermBackend } from "./WurmTermBackend.js";
import { Settings } from "./settings.js";

import { debounce } from "./helpers/debounce.js";
import { template, renderElement } from "./helpers/render.js";

/* WurmTerm main view showing all results in detail allowing filtering
   and starting runbooks for fixing issues. 
   
   On refresh emits a CheckResult event with data like this

      { warnings: <number>, critical: <number>, name: 'WurmTerm' }
*/

export class WurmTermView extends HTMLElement {
    // state
    #path;      // path where to find CSS
    #host;      // selected host (or undefined)
    #probe;     // selected probe (or undefined)

    // shadow dom
    #view;
  
    static #allHostsTemplate = template(`
    <div class='wurmTermWidget'>
        <div class='hosts'>
            {{#each results.hosts}}
            <div class='host'>
                <a class='name' data-host='{{@key}}'>
                    {{@key}}
                </a>
                {{#unless problems}}
                    <span class='probe severity_ok'>OK</span>
                {{/unless}}

                {{#eachSorted probes}}
                    <a data-host='{{host}}' data-probe='{{@key}}' class='probe severity_{{probeSeverity}}'>
                        {{@key}}
                    </a>
                {{/eachSorted}}
            </div>
            {{else}}
                <p>No results available yet...</p>
            {{/each}}
        </div>

        <hr/>

        <h3>SSH History</h3>

        {{#each history.hosts}}
            <span class='host'>
                <a data-host='{{this}}' class='name history'>
                    {{this}}
                </a>
            </span>
        {{else}}
            <p>No SSH history found.</p>
        {{/each}}
    </div>
    `);

    static #singleHostTemplate = template(`
    <div class='wurmTermWidget'>
        <div class='hosts'>
            {{#each results.hosts}}
            <div class='host'>
                <a class='name back' title='Back to host overview'>
                    &lt;
                </a>
                <a class='name' data-host='{{host}}'>
                    {{@key}}
                </a>
                {{#unless problems}}
                    <span class='probe severity_ok'>OK</span>
                {{/unless}}
                <div>
                {{#each probes}}
                    <a data-host='{{host}}' data-probe='{{@key}}' class='probe severity_{{probeSeverity}}'>
                        {{@key}}
                    </a>
                {{/each}}
                </div>
            </div>
            {{/each}}
        </div>

        {{#if probe}}
        <div class='details'>
            {{#with (lookup results.hosts host)}}
                {{#with (lookup probes ../probe)}}
                    <hr/>
                    <h3>
                        Probe Results for <span class="probe severity_{{probeSeverity}}">{{probe}}</span>
                    </h3>
                    <div class="output">
                        {{#compare stdout.length '>' 0}}
                            <pre>{{stdout}}</pre>
                        {{/compare}}
                        {{#compare stderr.length '>' 0}}
                            <pre class='stderr'>{{stderr}}</pre>
                        {{/compare}}
                    </div>
                    {{#compare stdout.length '==' 0}}
                        <i>Probe result is empty. All seems fine.</i>
                    {{/compare}}
                {{/with}}
            {{/with}}
        </div>
        {{/if}}

        {{#if probeDetails}}
        <details>
            <summary>Probe Command</summary>
            <div class="language-plaintext highlighter-rouge">
                <div class="highlight">                
                    <pre><code>{{probeDetails.command}}</code></pre>
                </div>
            </div>
        </details>

        <div id='wtv-solution'>
            <hr/>
            <h1>Solution Runbook</h1>

            <div id='wtv-solution-runbook'>
                <i>Sorry there is no solution runbook yet!</i>
            </div>
        </div>
        {{/if}}
    </div>
    `);

    static #mainTemplate = template(`
        <div id='wtv-runbook'>
            <div id='wtv-probes'>
                {{#compare status.started '!=' true}}
                    <p>
                        WurmTerm is a friendly terminal companion helper. Following you
                        along SSH and k8s sessions it will monitor for problems.
                        All cheat sheets marked with '🐛' can be executed as runbooks using WurmTerm!
                    </p>

                    <p>
                        Install the <a href="https://github.com/lwindolf/wurmterm-backend">agent</a> 
                        and click <button class="start">Launch</button>
                    </p>

                    <p>
                        <span style='font-weight: bold; color: #F47'>
                        By installing the agent and clicking 'Launch' below you will allow this page to run commands
                        on you computer and other connected systems!</span>
                    </p>
                {{else}}
                    <p>Connecting...</p>
                {{/compare}}
            </div>          
        </div>
    </div>
    `);

    constructor() {
        super();

        this.attachShadow({ mode: 'open' });
        this.#path = this.shadowRoot.host.dataset.path;
        
        const linkElem = document.createElement('link');
        linkElem.setAttribute("rel", "stylesheet");
        linkElem.setAttribute("href", (this.#path?this.#path:'') + "css/wurmterm.css");

        this.#view = document.createElement('div');
        this.#layout();

        this.shadowRoot.append(this.#view);
        this.shadowRoot.appendChild(linkElem);
    }

    async #layout() {
        if(await Settings.get('WurmTermAutoStart')) {
            console.log("WurmTerm: Auto starting backend connection...");
            WurmTermBackend.connect();
        }

        const status = WurmTermBackend.getStatus();

        renderElement(this.#view, WurmTermView.#mainTemplate, { status });
        const startBtn = this.#view.querySelector('button.start');
        if (startBtn) {
            startBtn.onclick = (ev) => {
                if (ev.target.classList.contains('start'))
                    this.#start();
            };
        }

        document.addEventListener('WurmTermBackendHistoryUpdate', () => {
            debounce(() => { this.#render() }, 1000)();
        }); 
        document.addEventListener('WurmTermProbeResult', () => {
            debounce(() => { this.#render() }, 1000)();
        });

        // Navigation
        this.#view.querySelector('#wtv-probes').addEventListener('click', (e) => {
            // probe or host click
            if(e.target.tagName === 'A' && 'host' in e.target.dataset) {              
                // For SSH history host button only trigger start
                if(e.target.classList.contains('history')) {
                    WurmTermBackend.start(e.target.dataset.host);
                    return;
                }

                this.#host = e.target.dataset.host;
                this.#probe = e.target.dataset?.probe;
                this.#render();
                return;
            }
            // back button
            if(e.target.tagName === 'A' && e.target.classList.contains('back')) {
                this.#host = undefined;
                this.#probe = undefined;
                this.#render();
                return;
            }
        });
    }

    #start() {
        this.#render();
        Runbook.enable(this.#view.querySelector('#wtv-runbook'), this.#host);
    }

    async #render() {
        const results = WurmTermBackend.getResults();
        const probeDetails = WurmTermBackend.getProbeByName(this.#probe);

        // Either provide all probes for all hosts
        if(!this.#host) {
            renderElement(
                this.#view.querySelector('#wtv-probes'),
                WurmTermView.#allHostsTemplate,
                {
                    results: { hosts: results.hosts },
                    history: WurmTermBackend.getHistory()
                }
            );
            return;
        }

        // ... or a per host + optional probe drilldown + optional runbook
        let singleHost = {
            results : { hosts: {} },
            host: this.#host,
            probe: this.#probe,
            probeDetails
        };
        if(results.hosts[this.#host])
            singleHost.results.hosts[this.#host] = results.hosts[this.#host];

        renderElement(
            this.#view.querySelector('#wtv-probes'),
            WurmTermView.#singleHostTemplate,
            singleHost
        );

        // Optionally add solution runbook content (assumption: all runbooks in section 'Wurmterm Runbooks' with this marker suffix!)
        /*if (probeDetails) {
            const runbookElement = this.#view.querySelector('#wtv-solution-runbook');
            await CheatSheetRenderer.renderDocument(runbookElement, 'WurmTerm Runbooks:::'+this.#probe);
            Runbook.enable(runbookElement);
        }*/
    }
}

customElements.define('x-wurmterm', WurmTermView);