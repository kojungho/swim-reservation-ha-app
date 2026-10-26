package kr.swim.phone;
/** Cancellable run lifecycle; the production implementation owns a WebView. */
interface PhoneExecution { void start(); void cancel(); }
