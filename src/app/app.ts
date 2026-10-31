import { Component } from '@angular/core';
import { ArmyPage } from './army/army-page';
import { CaptainsPage } from './captains/captains-page';

@Component({
  imports: [CaptainsPage, ArmyPage],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
