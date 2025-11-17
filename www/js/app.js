// vim: set ts=4 sw=4:
/* jshint esversion: 6 */

//import { setupNotebook } from './notebook.js';
import { WurmTermSettingsView } from './WurmTermSettingsView.js';
import { perfRenderer } from './renderer/perf-flamegraph.js';
import { netmapRenderer } from './renderer/netmap.js';

const params = new URLSearchParams(window.location.search);
const renderers = {
        'netmap': netmapRenderer,
        'perfFlameGraph': perfRenderer
};


function resortBoxes(list) {
        var children = Array.from(list.children);
        children
                .sort(function (a,b) {
                        var ac = 0, bc = 0;
                        if (a.getAttribute('collapsed') !== "1")
                                ac += 40;
                        if (b.getAttribute('collapsed') !== "1")
                                bc += 40;
                        if (a.classList.contains('severity_critical'))
                                ac += 20;
                        if (a.classList.contains('severity_warning'))
                                ac += 10;
                        if (b.classList.contains('severity_critical'))
                                bc += 20;
                        if (b.classList.contains('severity_warning'))
                                bc += 10;

                        if (a.innerText<b.innerText)
                                ac += 1;
                        else
                                bc += 1;

                        return (ac<bc?1:-1);
                })
                .forEach(node=>list.appendChild(node));
}

function view(id) {
        console.log(`view: ${id}`);     
        document.querySelectorAll('.main').forEach(function(el){ el.style.display = 'none'; });
        document.getElementById(id).style.display = 'block';

        if('settings' === id)
                new WurmTermSettingsView('settings');
}

function setupApp() {
        if('serviceWorker' in navigator)
                navigator.serviceWorker.register('./worker.js');

        if (navigator.storage && navigator.storage.persist)
                navigator.storage.persist();             
                
        document.querySelectorAll('#menu a').forEach(function(a){
                a.addEventListener('click', function() {
                        view(a.getAttribute('data-view'));
                });
        });

        view(params.get('view')?params.get('view'):'main');
        /*setupNotebook(
                params.get('host'),
                params.get('notebook')
        );*/

        var rendererEl = document.getElementById('renderer');
        if (rendererEl) {
                rendererEl.addEventListener('change', function() {
                        var visHost = document.getElementById('visualizedHost');
                        var hostText = visHost ? visHost.textContent : '';
                        visualizeHost(hostText, this.value);
                });
        }
}

export { setupApp, view };
