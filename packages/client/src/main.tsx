import { render } from 'preact';
import { App } from './app.ts';
import { browserStorage } from './persistence.ts';
import { Root } from './ui.tsx';
import './style.css';

const app = new App('new', browserStorage());
app.startScreen();
render(<Root app={app} />, document.getElementById('app')!);

// Handy for poking at the sim from the browser console.
(window as unknown as { app: App }).app = app;
