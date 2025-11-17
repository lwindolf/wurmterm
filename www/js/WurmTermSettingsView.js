// vim: set ts=4 sw=4:

import { WurmTermBackend } from "./WurmTermBackend.js";
import { Settings } from "./settings.js";
import { render, template } from "./helpers/render.js"

/* WurmTerm configuration view  */

class WurmTermSettingsView {
    #template = template(`
        <h1>WurmTerm Settings</h1>

        <div class='wurmTermSettings'>
            <p>Adapt settings and reload page for changes to take effect.</p>

            <div><input type='checkbox' id='WurmTermAutoStart' {{#ifTrue WurmTermAutoStart}}checked=''{{/ifTrue}}/> Automatically connect WurmTerm on page load (not recommended!).</div>
            <div><input type='checkbox' id='WurmTermHostProbing' {{#ifTrue WurmTermHostProbing}}checked=''{{/ifTrue}}'/> Probe services on discovered hosts.</div>

            <h2>Active Probes</h2>

            <p>Control which probes you want to run. Toggle their status by clicking.</p>

            Active:
            <div class="box" id="probesEnabled"></div>
            
            Disabled:
            <div class="box" id="probesDisabled"></div>

            <h2>Backend Endpoint</h2>

            <p>Websocket endpoint of the WurmTerm backend (usually <code>ws://localhost:8181/wurmterm</code>).</p>

            <input type="text" id="WurmTermBackendEndpoint" size="40" value='{{WurmTermBackendEndpoint}}'/>
        </div>
    `);

    constructor(selector) {
        this.#render(selector);
    }

    async #render(id) {
        const probeBlacklist = await Settings.get('WurmTermProbeBlacklist', WurmTermBackend.defaultProbeBlacklist);

        render('#'+id, this.#template, {
            WurmTermAutoStart       : await Settings.get('WurmTermAutoStart', WurmTermBackend.defaultAutoStart),
            WurmTermHostProbing     : await Settings.get('WurmTermHostProbing', WurmTermBackend.defaultHostProbing),
            WurmTermBackendEndpoint : await Settings.get('WurmTermBackendEndpoint', WurmTermBackend.defaultEndpoint),
            WurmTermProbeBlacklist  : probeBlacklist
        })

        if(WurmTermBackend.probes) {
            document.getElementById('probesDisabled').innerText = "";
            document.getElementById('probesEnabled').innerText = "";
            for(const name of Object.keys(WurmTermBackend.probes).sort()) {
                document.getElementById(
                        (probeBlacklist.includes(name)?'probesDisabled':'probesEnabled')
                ).innerHTML += `<div class='probe' data-name='${name}'>${name}</div>`;
            }
        }

        document.querySelector('.wurmTermSettings').onchange = ev => {
            console.log(ev.target.attributes.type)
            if(ev.target.attributes.type.value === 'text') {
                console.log(`${ev.target.id} changed: ${ev.target.value}`);
                Settings.set(ev.target.id, ev.target.value);
            }
            if(ev.target.attributes.type.value === 'checkbox') {
                console.log(`${ev.target.id} changed: ${ev.target.checked}`);
                Settings.set(ev.target.id, ev.target.checked);
            }
        };
        document.querySelector('.wurmTermSettings').onclick = ev => {
            if(ev.target.classList.contains('probe'))
                this.#settingsProbeToggle(ev);
        };
    }

    #settingsProbeToggle(ev) {
        var p = ev.target;
        var newParentId = ((p.parentNode.id === 'probesDisabled')?'probesEnabled':'probesDisabled');
        document.getElementById(newParentId).appendChild(p);

        var blacklist = [];
        for (const el of document.querySelectorAll('#probesDisabled .probe')) {
            blacklist.push(el.dataset.name);
        }
        Settings.set('WurmTermProbeBlacklist', blacklist);
    }
}

export { WurmTermSettingsView };