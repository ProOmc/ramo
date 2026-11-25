// The only dynamically typed boundary: original Ramo presentation/data APIs.
// New orchestration and persisted session contracts are checked independently.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LegacyObject=any;
export interface DesktopBridge{
 work:{request(method:string,params?:Record<string,unknown>):Promise<unknown>;onEvent(callback:(event:LegacyObject)=>void):()=>void};
 modelSummary():Promise<LegacyObject[]>;
 modelProfiles():Promise<LegacyObject[]>;
 pocket?:{speak(text:string):Promise<LegacyObject>;speakOnce?(text:string):Promise<LegacyObject>;status?():Promise<LegacyObject>;settings?(settings:Record<string,unknown>):Promise<LegacyObject>};
 [key:string]:LegacyObject;
}
declare global{
 interface Window{ramoDesktop:DesktopBridge;RamoRuntime:LegacyObject;RamoApplication:LegacyObject;RamoState:LegacyObject;RamoHarnessCore:LegacyObject;RamoOverlays:LegacyObject;RamoStudio:LegacyObject;RamoWork:LegacyObject;RamoImages:LegacyObject;RamoMemory:LegacyObject;__ramoAssistantInstance:LegacyObject;__ramoWorkspaceUIActive:LegacyObject;__ramoModelRegistry:LegacyObject[];[key:string]:LegacyObject;}
}
