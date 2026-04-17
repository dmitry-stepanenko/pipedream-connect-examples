import { NgComponentOutlet, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  type InputSignal,
  type Type,
} from '@angular/core';
import {
  RenderMessageComponent,
  type UiChatSchemaComponent,
} from '@hashbrownai/angular';

export interface CosMessageComponentWithId {
  cosHbNodeId: InputSignal<string>;
}

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'cos-hb-render-message',
  imports: [NgComponentOutlet, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // this is a copy of the original hashbrown template with the support of rendered component ids
  template: `
    <ng-template #nodeTemplateRef let-node="node" let-nodeIndex="nodeIndex">
      <ng-template #childrenTemplateRef>
        @if (isTextNode(node)) {
          {{ node.$children }}
        } @else {
          @for (child of node.$children; track $index) {
            <ng-container
              *ngTemplateOutlet="nodeTemplateRef; context: { node: child }"
            />
          }
        }
      </ng-template>

      @if (node) {
        <ng-container
          *ngComponentOutlet="
            getTagComponent(node.$tag);
            inputs: getNodeComponentProps(node, nodeIndex);
            content: getRootNodes(childrenTemplateRef)
          "
        />
      }
    </ng-template>

    @if (content()) {
      @for (node of content(); track $index) {
        <ng-template
          [ngTemplateOutlet]="nodeTemplateRef"
          [ngTemplateOutletContext]="node"
        />
        <ng-container
          *ngTemplateOutlet="
            nodeTemplateRef;
            context: { node: node, nodeIndex: $index }
          "
        />
      }
    }
  `,
})
export class CosRenderMessageComponent extends RenderMessageComponent {
  readonly messageIndex = input.required<number>();

  override getTagComponent(tagName: string): Type<object> | null {
    return super.getTagComponent(tagName) ?? null;
  }

  getNodeComponentProps(node: UiChatSchemaComponent, nodeIndex: number) {
    const component = this.tagNameRegistry()?.[node.$tag]?.component;
    if (!(component as any)?.['ɵcmp']?.declaredInputs?.cosHbNodeId) {
      if (ngDevMode) {
        console.warn(
          `Could not resolve component "${node.$tag}" or it's "cosHbNodeId" input`,
        );
      }
      return node.$props;
    }
    return {
      ...node.$props,
      cosHbNodeId: `m_${this.messageIndex()}_n_${nodeIndex}`,
    };
  }
}
