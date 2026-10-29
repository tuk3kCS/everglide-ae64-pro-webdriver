"use strict";
// Actual updater, reconnect loop, HID transport and page handoff; simulated USB only.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const F = require("../../js/firmware/flasher.js"), R = require("../../js/firmware/reconnect.js"), { AE64HidTransport } = require("../../protocol.js");
function image() {
  const b = new Uint8Array(4213), d = new DataView(b.buffer); b.fill(0x69,4096);
  [0xbeaf5aa5,F.BOARD,4096,117,F.crc32(b.subarray(4096))].forEach((v,i)=>d.setUint32(i*4,v,true));return b;
}
async function fixture(options = {}) {
  const world = { phase:"app", time:0, permissions:!options.permission, requests:0, inspected:0, writes:0, polls:0, logs:[], renders:0, nextChoice:null };
  class Device {
    constructor(mode,serial=1,board=F.BOARD) { this.mode=mode;this.serial=serial;this.board=board;this.vendorId=0x1ca6;this.productId=mode===255?0x300b:0x300a;this.collections=[{usagePage:mode===255?0xff80:0xffb0,usage:1}];this.opened=false;this.listeners=new Set();this.sent=[];this.failures=0; }
    async open() { if(this.failures-- > 0)throw new Error("USB still starting");this.opened=true; }
    async close() { this.opened=false; }
    addEventListener(type,fn) { if(type==="inputreport")this.listeners.add(fn); }
    removeEventListener(type,fn) { if(type==="inputreport")this.listeners.delete(fn); }
    async sendReport(id,q) {
      assert.equal(id,0);this.sent.push(q.slice());const r=new Uint8Array(64);r.set(q.subarray(0,2));
      if(q[0]===1&&q[1]===2) {new DataView(r.buffer).setUint32(4,this.board,false);r.set([0,1,0,0],8);r[16]=this.mode;r[17]=this.serial;}
      else if(q[0]===8) {
        if(q[1]===1) {world.phase="boot";if(options.lostEnterAck){queueMicrotask(()=>state.transport.close());return;}}
        if(q[1]===2) {assert.equal(this.mode,255);world.writes++;}
        if(q[1]===3)r[2]=1;
        if(q[1]===4)world.phase="restarted";
      }
      queueMicrotask(()=>this.listeners.forEach(fn=>fn({data:new DataView(r.buffer)})));
    }
  }
  const app=new Device(0),boot=new Device(255),restarted=new Device(0),wrong=new Device(255,2,123);
  const transport=new AE64HidTransport(app,{allowBootloader:true});await transport.open();
  const state={transport,knownDevice:app,firmwareBusy:false,page:"firmware",timers:{},hardware:{info:{firmware:"0.1.0.0"}}};
  const nodes=new Map();function node(selector){if(!nodes.has(selector)){const classes=new Set();nodes.set(selector,{textContent:"",value:0,disabled:false,listeners:{},classList:{toggle(k,v){if(v)classes.add(k);else classes.delete(k)},contains:k=>classes.has(k)},addEventListener(t,fn){this.listeners[t]=fn},showModal(){},close(){}})}return nodes.get(selector)}
  class FastReconnect extends R.Reconnector {
    constructor(input) {super({...input,now:()=>world.time,delay:async(ms)=>{world.time+=ms;await new Promise(setImmediate)},timeout:5000,interval:100});}
  }
  let c;
  const hid={
    async getDevices(){world.polls++;if(world.phase==="boot"){if(options.onPoll)await options.onPoll({world,c,boot,wrong});return world.permissions?[boot]:[]}return world.phase==="restarted"?[restarted]:[app]},
    async requestDevice(){world.requests++;if(options.permissionDenied)throw Object.assign(new Error("Denied"),{name:"NotAllowedError"});if(options.cancelPicker)return [];const picked=world.nextChoice||boot;world.permissions=true;return [picked]},
  };
  c={window:null,state,console,URL,Uint8Array,ArrayBuffer,DataView,setTimeout,clearTimeout,navigator:{hid},AE64HidTransport,
    AE64Firmware:F,AE64FirmwareReconnect:{...R,Reconnector:FastReconnect},document:{baseURI:"http://localhost/",querySelector:node,querySelectorAll:()=>[]},
    toolOperationBusy:()=>Boolean(state.firmwareBusy||state.connecting),dirtyCount:()=>0,esc:String,stopPolling(){},stopProfilePolling(){},disposeGamepadPage(){},resetFnLightingCapability(){},
    render(){world.renders++},renderStatus(){},showToast(){},log:(...x)=>world.logs.push(x),
    async connectKeyboard(device){const t=new AE64HidTransport(device,{allowBootloader:true});await t.open();state.transport=t;return true},
  };c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(__dirname,"../../js/app/firmware-page.js"),"utf8"),c);
  const prepared=await F.prepare(image(),{name:"Reviewed local image",file:"reviewed.bin",appVersion:"0.1.0.0"});c.prepared=prepared;
  vm.runInContext("firmwareView.prepared=prepared;firmwareView.selectedId='local';",c);
  return{world,state,app,boot,restarted,wrong,c,node,prepared,run:code=>vm.runInContext(code,c),async close(){if(state.transport)await state.transport.close()}};
}
async function main(){
  for(const lostEnterAck of [false,true]){
    const f=await fixture({lostEnterAck});try{await f.run("startFirmwareUpdate()");assert.equal(f.run("firmwareView.phase"),"complete");assert.equal(f.world.requests,0);assert.equal(f.world.writes,Math.ceil(f.prepared.bytes.length/56));assert.equal(f.run("firmwareView.prepared"),f.prepared);assert.equal(f.state.transport.device,f.restarted);}finally{await f.close()}
  }
  let prompted=false;
  const p=await fixture({permission:true,onPoll:async({c,boot})=>{if(!prompted){prompted=true;boot.failures=1;await vm.runInContext("authorizeFirmwareHandoff()",c)}}});
  try{await p.run("startFirmwareUpdate()");assert.equal(p.world.requests,1);assert.equal(p.run("firmwareView.phase"),"complete");assert.equal(p.run("firmwareView.prepared"),p.prepared);assert.equal(p.world.writes,Math.ceil(p.prepared.bytes.length/56));assert.equal(p.run("firmwareView.waiting"),null);}finally{await p.close()}
  // A wrong device is checked and closed, then permission can be granted again
  // within the original update without reselecting/reviewing the file.
  let step=0;
  const bad=await fixture({permission:true,onPoll:async({world,c,boot,wrong})=>{
    if(step===0){step=1;world.nextChoice=wrong;await vm.runInContext("authorizeFirmwareHandoff()",c);world.permissions=false;}
    else if(step===1&&vm.runInContext("!firmwareView.waiting.manualDevice",c)){step=2;world.nextChoice=boot;await vm.runInContext("authorizeFirmwareHandoff()",c);}
  }});
  try{await bad.run("startFirmwareUpdate()");assert.equal(bad.world.requests,2);assert.equal(bad.wrong.opened,false);assert.equal(bad.wrong.sent.some(q=>q[0]===8),false);assert.equal(bad.run("firmwareView.phase"),"complete");}finally{await bad.close()}
  // Permission errors and canceled pickers never send writes to a guessed device.
  for(const flag of ["permissionDenied","cancelPicker"]){let invoked=false;const f=await fixture({permission:true,[flag]:true,onPoll:async({c})=>{if(!invoked){invoked=true;await vm.runInContext("authorizeFirmwareHandoff()",c)}}});try{await f.run("startFirmwareUpdate()");assert.equal(f.run("firmwareView.phase"),"error");assert.equal(f.world.writes,0);assert.equal(f.run("firmwareView.prepared"),f.prepared);assert.equal(f.state.firmwareBusy,false);}finally{await f.close()}}
  // Manual reconnect after a failed transfer retains its image but requires a
  // fresh explicit Start; no partial image is silently resumed.
  const f=await fixture();try{
    f.c.connectKeyboard=async()=>{f.state.bootloaderConnected=true;f.run("firmwareView.prepared=null;firmwareView.selectedId='' ");return true};
    await f.run("connectFirmwareDevice()");assert.equal(f.run("firmwareView.prepared"),f.prepared);assert.equal(f.run("firmwareView.selectedId"),"local");assert.equal(f.world.writes,0);
  }finally{await f.close()}
  console.log("PASS: real updater handoff without refresh/reselection; automatic boot/app reconnect, lost entry ACK, browser authorization, transient opens, rejected choices, cancel/denial, and retained image after errors. Simulated USB only.");
}
main().catch(e=>{console.error(e);process.exitCode=1});
