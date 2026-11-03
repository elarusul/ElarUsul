import { Component, inject } from '@angular/core';
import { ArmyPage } from './army/army-page';
// import { CaptainsPage } from './captains/captains-page';
import { I18nService } from './i18n/i18n.service';

@Component({
  imports: [/* CaptainsPage, */ ArmyPage],
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly i18n = inject(I18nService);
}
