// vim: set ts=4 sw=4:

import { WurmTermBackend } from "./WurmTermBackend.js";
import { Settings } from "./settings.js";
import { template, renderElement } from "./helpers/render.js";
import { W } from "./vendor/chunks/mermaid.esm.min/chunk-63GW7ZVL.mjs";

// Widget displaying the connection status to the WurmTerm backend
// and handling authentication if required

export class WurmTermConnect extends HTMLElement {
    // state
    #path;      // path where to find CSS

    // shadow dom
    #view;

    #template = template(`
        <div class='wurmTermConnect'>
            <div class='hint'>
                {{#compare status.started '!=' true}}
                    <p>
                        WurmTerm is a friendly terminal companion helper. Following you
                        along SSH and k8s sessions it will monitor for problems.
                    </p>

                    <p>
                        Install the <a href="https://github.com/lwindolf/wurmterm-backend">agent</a> 
                        and click <button id="launch">Launch</button>
                    </p>

                    <p>
                        <span style='font-weight: bold; color: #F47'>
                        By installing the agent and clicking 'Launch' you will allow this page to run commands
                        on you computer and other connected systems!</span>
                    </p>
                {{else}}
                    {{#if status.authFailure}}
                    <p>
                            <div id='wurmTermAuth'>
                            Passwort: <input type='password' name='password'/>
                            <button id="wurmTermPasswordSet">Login</button>
                            </div>
                    </p>
                    <p>
                            In case you have forgotten your password set a new one by running
                            <code>wurm configure</code>
                    </p>
                    {{/if}}

                    {{#compare status.connected '!=' true}}
                        <p>Connecting...</p>
                    {{else}}
                        <p>Connected!</p>
                    {{/compare}}

                    {{#if status.error}}
                            <p>{{status.error}}</p>
                    {{/if}}
                {{/compare}}
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
        this.#view.id = 'wurmTermConnect';

        this.shadowRoot.append(this.#view);
        this.shadowRoot.appendChild(linkElem);

        document.addEventListener('WurmTermBackendStatus', (e) => {
            if(e.detail.ready) {
                this.#view.style.display = 'none';
                return;
            } else {
                this.#view.style.display = 'block';
            }

            this.#render();
        });

        this.#view.addEventListener('click', async (e) => {
                if(e.target.id === 'wurmTermPasswordSet') {
                        await Settings.set("WurmTermBackendPassword", this.#view.querySelector('#wurmTermAuth input[type="password"]').value);
                        WurmTermBackend.reconnect();
                        this.#render();
                }
                if(e.target.id === 'launch') {
                        WurmTermBackend.connect();
                        this.#render();
                }
        });

        this.#render();
     }

     #render() {
        renderElement(this.#view, this.#template, {
                status: WurmTermBackend.getStatus()
        })
     }
}

customElements.define('x-wurmterm-connect', WurmTermConnect);