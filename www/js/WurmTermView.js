// vim: set ts=4 sw=4:

import "./WurmTermConnect.js";
import { WurmTermBackend } from "./WurmTermBackend.js";

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
        <h3>Connected</h3>
        <div class='hosts'>
            {{#each results.hosts}}
            <div class='host'>
                <a class='name' data-host='{{@key}}'>
                    {{@key}}
                </a>
                {{#unless problems}}
                    <span class='probe severity_ok'>OK</span>
                {{/unless}}

                {{#each probes}}
                    {{#if probeSeverity}}
                    {{#compare probeSeverity '!==' 'normal'}}
                    {{#compare probeSeverity '!==' 'empty'}}
                        <a data-probe='{{@key}}' data-host='{{@../key}}' class='probe severity_{{probeSeverity}}'>
                            {{@key}}
                        </a>
                    {{/compare}}
                    {{/compare}}
                    {{/if}}
                {{/each}}
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

        <hr/>

        <h3>kubernetes</h3>

        {{#each history.kubectxt}}
            <span class='host'>
                <a data-host='{{this}}' class='name history'>
                    {{this.name}}/{{this.context.namespace}}
                </a>
            </span>
        {{else}}
            <p>No other kubectl contexts found.</p>
        {{/each}}

        <hr/>

        <h3>Local Network</h3>

        {{#each localnet.hosts}}
            <div class='host'>
                <a data-host='{{@key}}' class='name history'>
                    {{@key}}
                </a>
                {{#each services}}
                    {{#if url}}
                        <a href="{{url}}" target="_blank" class='probe severity_normal'>{{name}}</a>
                    {{else}}
                        <span class='probe'>{{name}}</span>
                    {{/if}}
                {{/each}}
            </div>
        {{else}}
            <p>No local network devices found.</p>
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
                {{#eachSorted probes}}
                    <a data-host='{{host}}' data-probe='{{@key}}' class='probe severity_{{probeSeverity}}'>
                        {{@key}}
                    </a>
                {{/eachSorted}}
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
                        <span class="probe severity_{{probeSeverity}}">{{probe}}</span> Probe Results
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
            <x-wurmterm-connect></x-wurmterm-connect>
            <div id='wtv-probes'>
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

        document.addEventListener('WurmTermBackendHistoryUpdate', () => {
            debounce(() => { this.#render() }, 1000)();
        }); 
        document.addEventListener('WurmTermProbeResult', () => {
            debounce(() => { this.#render() }, 1000)();
        });
        document.addEventListener('WurmTermBackendLocalNetUpdate', () => {
            debounce(() => { this.#render() }, 1000)();
        });

        this.shadowRoot.append(this.#view);
        this.shadowRoot.appendChild(linkElem);
    }

    async #layout() {
        renderElement(this.#view, WurmTermView.#mainTemplate, {});

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
                    history: WurmTermBackend.getHistory(),
                    localnet: WurmTermBackend.getLocalNet()
                }
            );
            return;
        }

        // ... or a per host + optional probe drilldown + optional runbook
        let singleHost = {
            results : { hosts: {} },
            localnet: WurmTermBackend.getLocalNet(),
            host: this.#host,
            probe: this.#probe,
            probeDetails,
            singleHost: true
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