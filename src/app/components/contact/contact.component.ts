
import { ChangeDetectionStrategy, Component, signal, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '../../pipes/translate.pipe';
import { MetaService } from '../../services/meta.service';
import { ContactService } from '../../services/contact.service';
import { RecaptchaService } from '../../services/recaptcha.service';

@Component({
  selector: 'app-contact',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe],
  templateUrl: './contact.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ContactComponent implements OnInit {
  private fb = inject(FormBuilder);
  private contactService = inject(ContactService);
  protected recaptchaService = inject(RecaptchaService);

  private meta = inject(MetaService);

  ngOnInit(): void {
    this.meta.updateMeta({
      titleKey: 'meta.contact.title',
      descriptionKey: 'meta.contact.description',
      path: '/contact'
    });
  }
  contactForm: FormGroup;
  isSubmitting = signal(false);
  submitSuccess = signal(false);
  submitError = signal(false);

  constructor() {
    this.contactForm = this.fb.group({
      name: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      subject: ['', Validators.required],
      message: ['', Validators.required]
    });
  }

  async onSubmit() {
    if (this.contactForm.valid) {
      this.isSubmitting.set(true);
      this.submitSuccess.set(false);
      this.submitError.set(false);

      try {
        const recaptchaToken = await this.recaptchaService.executeRecaptcha('contact_form');
        await this.contactService.submitContactForm({
          ...this.contactForm.value,
          recaptchaToken
        });
        this.contactForm.reset();
        this.submitSuccess.set(true);
      } catch (error) {
        console.error('Error submitting form:', error);
        this.submitError.set(true);
      } finally {
        this.isSubmitting.set(false);
      }
    }
  }
}