import { useEditor } from "../src/state/editor-store";
const s = () => useEditor.getState();
const cap = (id:string, st:number, d:number, text:string) => ({id, trackId:"text", type:"text" as const, sourceUrl:"", startTime:st, duration:d, sourceInStart:0, sourceInEnd:d, textContent:text, isCaption:true});
useEditor.setState({ tracks: [{id:"text", type:"text", label:"Texto", clips:[cap("c1",7.82,10,"e A")]}] as any, sourceDuration: 17.82 });
// teste 4: editar texto
s().updateClip("c1", { textContent: "olá mundo" });
console.log("edit texto ->", s().tracks[0].clips[0].textContent);
// teste 5: arrastar borda direita para 25s
s().trimClip("c1","end",25);
let c = s().tracks[0].clips[0];
console.log("trim end 25 -> start", c.startTime.toFixed(2), "dur", c.duration.toFixed(2), "fim", (c.startTime+c.duration).toFixed(2));
s().trimClip("c1","start",3);
c = s().tracks[0].clips[0];
console.log("trim start 3 -> start", c.startTime.toFixed(2), "dur", c.duration.toFixed(2));
// teste chunking com transcript ruim
const { chunkSegmentsByText } = await import("../src/lib/caption-chunking");
console.log("chunk 'e A' 10s ->", JSON.stringify(chunkSegmentsByText([{start:7.82,end:17.82,text:"e A"}], {maxWords:6,maxChars:32,pauseThresholdMs:350})));
