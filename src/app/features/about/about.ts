import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Disclosure } from '../../components/ui';

@Component({
  selector: 'app-about',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Disclosure],
  templateUrl: './about.html',
})
export class About {}
