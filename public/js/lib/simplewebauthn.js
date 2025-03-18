/* [@simplewebauthn/browser@13.1.0] */
!function(e,t){"object"==typeof exports&&"undefined"!=typeof module?t(exports):"function"==typeof define&&define.amd?define(["exports"],t):t((e="undefined"!=typeof globalThis?globalThis:e||self).SimpleWebAuthnBrowser={})}(this,(function(e){"use strict";function t(e){const t=new Uint8Array(e);let r="";for(const e of t)r+=String.fromCharCode(e);return btoa(r).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"")}function r(e){const t=e.replace(/-/g,"+").replace(/_/g,"/"),r=(4-t.length%4)%4,n=t.padEnd(t.length+r,"="),o=atob(n),i=new ArrayBuffer(o.length),a=new Uint8Array(i);for(let e=0;e<o.length;e++)a[e]=o.charCodeAt(e);return i}function n(){return o.stubThis(void 0!==globalThis?.PublicKeyCredential&&"function"==typeof globalThis.PublicKeyCredential)}const o={stubThis:e=>e};function i(e){const{id:t}=e;return{...e,id:r(t),transports:e.transports}}function a(e){return"localhost"===e||/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i.test(e)}class s extends Error{constructor({message:e,code:t,cause:r,name:n}){super(e,{cause:r}),Object.defineProperty(this,"code",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),this.name=n??r.name,this.code=t}}const l=new class{constructor(){Object.defineProperty(this,"controller",{enumerable:!0,configurable:!0,writable:!0,value:void 0})}createNewAbortSignal(){if(this.controller){const e=new Error("Cancelling existing WebAuthn API call for new one");e.name="AbortError",this.controller.abort(e)}const e=new AbortController;return this.controller=e,e.signal}cancelCeremony(){if(this.controller){const e=new Error("Manually cancelling existing WebAuthn API call");e.name="AbortError",this.controller.abort(e),this.controller=void 0}}},c=["cross-platform","platform"];function u(e){if(e&&!(c.indexOf(e)<0))return e}function d(e,t){console.warn(`The browser extension that intercepted this WebAuthn API call incorrectly implemented ${e}. You should report this error to them.\n`,t)}function h(){if(!n())return p.stubThis(new Promise((e=>e(!1))));const e=globalThis.PublicKeyCredential;return void 0===e?.isConditionalMediationAvailable?p.stubThis(new Promise((e=>e(!1)))):p.stubThis(e.isConditionalMediationAvailable())}const p={stubThis:e=>e};e.WebAuthnAbortService=l,e.WebAuthnError=s,e._browserSupportsWebAuthnAutofillInternals=p,e._browserSupportsWebAuthnInternals=o,e.base64URLStringToBuffer=r,e.browserSupportsWebAuthn=n,e.browserSupportsWebAuthnAutofill=h,e.bufferToBase64URLString=t,e.platformAuthenticatorIsAvailable=function(){return n()?PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable():new Promise((e=>e(!1)))},e.startAuthentication=async function(e){!e.optionsJSON&&e.challenge&&(console.warn("startAuthentication() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information."),e={optionsJSON:e});const{optionsJSON:o,useBrowserAutofill:c=!1,verifyBrowserAutofillInput:d=!0}=e;if(!n())throw new Error("WebAuthn is not supported in this browser");let p;0!==o.allowCredentials?.length&&(p=o.allowCredentials?.map(i));const f={...o,challenge:r(o.challenge),allowCredentials:p},b={};if(c){if(!await h())throw Error("Browser does not support WebAuthn autofill");if(document.querySelectorAll("input[autocomplete$='webauthn']").length<1&&d)throw Error('No <input> with "webauthn" as the only or last value in its `autocomplete` attribute was detected');b.mediation="conditional",f.allowCredentials=[]}let R;b.publicKey=f,b.signal=l.createNewAbortSignal();try{R=await navigator.credentials.get(b)}catch(e){throw function({error:e,options:t}){const{publicKey:r}=t;if(!r)throw Error("options was missing required publicKey property");if("AbortError"===e.name){if(t.signal instanceof AbortSignal)return new s({message:"Authentication ceremony was sent an abort signal",code:"ERROR_CEREMONY_ABORTED",cause:e})}else{if("NotAllowedError"===e.name)return new s({message:e.message,code:"ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",cause:e});if("SecurityError"===e.name){const t=globalThis.location.hostname;if(!a(t))return new s({message:`${globalThis.location.hostname} is an invalid domain`,code:"ERROR_INVALID_DOMAIN",cause:e});if(r.rpId!==t)return new s({message:`The RP ID "${r.rpId}" is invalid for this domain`,code:"ERROR_INVALID_RP_ID",cause:e})}else if("UnknownError"===e.name)return new s({message:"The authenticator was unable to process the specified options, or could not create a new assertion signature",code:"ERROR_AUTHENTICATOR_GENERAL_ERROR",cause:e})}return e}({error:e,options:b})}if(!R)throw new Error("Authentication was not completed");const{id:g,rawId:w,response:A,type:E}=R;let m;return A.userHandle&&(m=t(A.userHandle)),{id:g,rawId:t(w),response:{authenticatorData:t(A.authenticatorData),clientDataJSON:t(A.clientDataJSON),signature:t(A.signature),userHandle:m},type:E,clientExtensionResults:R.getClientExtensionResults(),authenticatorAttachment:u(R.authenticatorAttachment)}},e.startRegistration=async function(e){!e.optionsJSON&&e.challenge&&(console.warn("startRegistration() was not called correctly. It will try to continue with the provided options, but this call should be refactored to use the expected call structure instead. See https://simplewebauthn.dev/docs/packages/browser#typeerror-cannot-read-properties-of-undefined-reading-challenge for more information."),e={optionsJSON:e});const{optionsJSON:o,useAutoRegister:c=!1}=e;if(!n())throw new Error("WebAuthn is not supported in this browser");const h={...o,challenge:r(o.challenge),user:{...o.user,id:r(o.user.id)},excludeCredentials:o.excludeCredentials?.map(i)},p={};let f;c&&(p.mediation="conditional"),p.publicKey=h,p.signal=l.createNewAbortSignal();try{f=await navigator.credentials.create(p)}catch(e){throw function({error:e,options:t}){const{publicKey:r}=t;if(!r)throw Error("options was missing required publicKey property");if("AbortError"===e.name){if(t.signal instanceof AbortSignal)return new s({message:"Registration ceremony was sent an abort signal",code:"ERROR_CEREMONY_ABORTED",cause:e})}else if("ConstraintError"===e.name){if(!0===r.authenticatorSelection?.requireResidentKey)return new s({message:"Discoverable credentials were required but no available authenticator supported it",code:"ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT",cause:e});if("conditional"===t.mediation&&"required"===r.authenticatorSelection?.userVerification)return new s({message:"User verification was required during automatic registration but it could not be performed",code:"ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE",cause:e});if("required"===r.authenticatorSelection?.userVerification)return new s({message:"User verification was required but no available authenticator supported it",code:"ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT",cause:e})}else{if("InvalidStateError"===e.name)return new s({message:"The authenticator was previously registered",code:"ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED",cause:e});if("NotAllowedError"===e.name)return new s({message:e.message,code:"ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",cause:e});if("NotSupportedError"===e.name)return 0===r.pubKeyCredParams.filter((e=>"public-key"===e.type)).length?new s({message:'No entry in pubKeyCredParams was of type "public-key"',code:"ERROR_MALFORMED_PUBKEYCREDPARAMS",cause:e}):new s({message:"No available authenticator supported any of the specified pubKeyCredParams algorithms",code:"ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG",cause:e});if("SecurityError"===e.name){const t=globalThis.location.hostname;if(!a(t))return new s({message:`${globalThis.location.hostname} is an invalid domain`,code:"ERROR_INVALID_DOMAIN",cause:e});if(r.rp.id!==t)return new s({message:`The RP ID "${r.rp.id}" is invalid for this domain`,code:"ERROR_INVALID_RP_ID",cause:e})}else if("TypeError"===e.name){if(r.user.id.byteLength<1||r.user.id.byteLength>64)return new s({message:"User ID was not between 1 and 64 characters",code:"ERROR_INVALID_USER_ID_LENGTH",cause:e})}else if("UnknownError"===e.name)return new s({message:"The authenticator was unable to process the specified options, or could not create a new credential",code:"ERROR_AUTHENTICATOR_GENERAL_ERROR",cause:e})}return e}({error:e,options:p})}if(!f)throw new Error("Registration was not completed");const{id:b,rawId:R,response:g,type:w}=f;let A,E,m,y;if("function"==typeof g.getTransports&&(A=g.getTransports()),"function"==typeof g.getPublicKeyAlgorithm)try{E=g.getPublicKeyAlgorithm()}catch(e){d("getPublicKeyAlgorithm()",e)}if("function"==typeof g.getPublicKey)try{const e=g.getPublicKey();null!==e&&(m=t(e))}catch(e){d("getPublicKey()",e)}if("function"==typeof g.getAuthenticatorData)try{y=t(g.getAuthenticatorData())}catch(e){d("getAuthenticatorData()",e)}return{id:b,rawId:t(R),response:{attestationObject:t(g.attestationObject),clientDataJSON:t(g.clientDataJSON),transports:A,publicKeyAlgorithm:E,publicKey:m,authenticatorData:y},type:w,clientExtensionResults:f.getClientExtensionResults(),authenticatorAttachment:u(f.authenticatorAttachment)}}}));
