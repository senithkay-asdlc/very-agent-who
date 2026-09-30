Feature: Sentence threat classification

  @story-1 @story-2
  Rule: A submitted sentence is classified as threatening or not threatening

    Scenario: A threatening sentence is classified
      Given the Calling System has a sentence, "I will find you and make you pay"
      When it submits that sentence for classification
      Then it receives the label "threatening"

    Scenario: A non-threatening sentence is classified
      Given the Calling System has a sentence, "Let's grab lunch tomorrow at noon"
      When it submits that sentence for classification
      Then it receives the label "not threatening"

  @story-1
  Rule: Every submitted sentence and its resulting label is recorded

    Scenario: A classified sentence is retained
      Given the Calling System has submitted the sentence "Meet me outside after school and you'll regret it" for classification
      When the classification is returned
      Then a record exists pairing that exact sentence with its label

  @story-1
  Rule: Any calling system may submit a sentence without prior authentication

    Scenario: An unauthenticated caller receives a classification
      Given the Calling System presents no credentials
      When it submits the sentence "The weather looks great for a picnic this weekend" for classification
      Then it receives a classification label in response
